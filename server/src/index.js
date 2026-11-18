// ============================================================
//  Dominó Pro — Servidor
//  Express (auth/REST) + Socket.IO (multiplayer em tempo real)
//  Matchmaking: fila online → se ninguém aparecer, joga com IA
// ============================================================
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

import {
  newRound, legalMoves, canDraw, canPass, playTile, drawTile,
  passTurn, forfeit, nextRound, pipSum, GOAL_SCORE,
} from './game.js';
import { botAction } from './ai.js';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'domino-pro-dev-secret-troque-em-producao';
const QUEUE_AI_TIMEOUT = 8000;   // ms esperando oponente antes de chamar a IA
const ROUND_BREAK = 6000;        // ms entre rodadas
const BOT_MIN_DELAY = 800;
const BOT_MAX_DELAY = 1600;
const RECONNECT_GRACE = 45000;   // ms de tolerância para reconectar

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET não definido — usando valor de desenvolvimento.');
}

const app = express();
app.use(express.json({ limit: '64kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e5,
});

// ------------------------------------------------------------
//  REST API
// ------------------------------------------------------------
function sign(user) {
  return jwt.sign({ sub: user.id, name: user.displayName }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = store.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
}

const AVATARS = ['🦦', '🦊', '🐼', '🦉', '🐸', '🦁', '🐯', '🐵', '🦄', '🐙', '🐺', '🐨', '🦅', '🐲'];

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, avatar } = req.body || {};
    const name = String(username || '').trim();
    if (!/^[A-Za-zÀ-ÿ0-9_\- ]{3,20}$/.test(name)) {
      return res.status(400).json({ error: 'Nome de usuário: 3 a 20 caracteres.' });
    }
    if (String(password || '').length < 6) {
      return res.status(400).json({ error: 'A senha precisa de pelo menos 6 caracteres.' });
    }
    if (store.findByUsername(name)) {
      return res.status(409).json({ error: 'Esse nome de usuário já está em uso.' });
    }
    const av = AVATARS.includes(avatar) ? avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const hash = await bcrypt.hash(password, 10);
    const user = store.createUser({ username: name, passwordHash: hash, avatar: av });
    res.json({ token: sign(user), user: store.publicUser(user) });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Erro ao criar a conta.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = store.findByUsername(username);
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }
    res.json({ token: sign(user), user: store.publicUser(user) });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Erro ao entrar.' });
  }
});

app.get('/api/me', auth, (req, res) => res.json({ user: store.publicUser(req.user) }));
app.get('/api/leaderboard', (req, res) => res.json({ top: store.leaderboard(10) }));
app.get('/api/online', (req, res) => res.json({ online: onlineUsers.size }));

// ------------------------------------------------------------
//  Estado do servidor
// ------------------------------------------------------------
/** @type {Map<string, object>} sala de jogo */
const games = new Map();
/** fila de espera: [{userId, displayName, avatar, socket, timer}] */
let queue = [];
/** userId -> socket autenticado */
const socketsByUser = new Map();
/** userId -> {room, seat} para reconexão */
const roomByUser = new Map();
/** usuários conectados na plataforma */
const onlineUsers = new Set();

function authenticateSocket(socket) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET);
    const user = store.findById(payload.sub);
    return user || null;
  } catch {
    return null;
  }
}

function broadcastOnline() {
  io.emit('players:online', { online: onlineUsers.size });
}

// ------------------------------------------------------------
//  Matchmaking
// ------------------------------------------------------------
function leaveQueue(userId) {
  const entry = queue.find((q) => q.userId === userId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  queue = queue.filter((q) => q.userId !== userId);
  entry.socket?.emit('queue:status', { searching: false });
  return true;
}

function joinQueue(socket, user) {
  if (inRoom(user.id)) {
    socket.emit('game:error', { message: 'Você já está em uma partida.' });
    return;
  }
  if (queue.some((q) => q.userId === user.id)) return;

  const entry = {
    userId: user.id,
    displayName: user.displayName,
    avatar: user.avatar,
    socket,
    timer: null,
  };

  // Se já tem alguém esperando, casa na hora
  const waiting = queue.shift();
  if (waiting) {
    clearTimeout(waiting.timer);
    createOnlineGame(waiting, entry);
    return;
  }

  queue.push(entry);
  socket.emit('queue:status', { searching: true, message: 'Procurando oponente…' });
  entry.timer = setTimeout(() => {
    if (!queue.some((q) => q.userId === entry.userId)) return;
    queue = queue.filter((q) => q.userId !== entry.userId);
    entry.socket?.emit('queue:status', {
      searching: false,
      message: 'Ninguém disponível agora — você vai jogar contra a IA.',
    });
    createAiGame(entry);
  }, QUEUE_AI_TIMEOUT);
}

// ------------------------------------------------------------
//  Salas de jogo
// ------------------------------------------------------------
function makeSeat(source, isBot = false) {
  if (isBot) {
    return { userId: null, displayName: 'CPU', avatar: '🤖', isBot: true, socket: null, connected: true, graceTimer: null };
  }
  return {
    userId: source.userId,
    displayName: source.displayName,
    avatar: source.avatar,
    isBot: false,
    socket: source.socket || null,
    connected: true,
    graceTimer: null,
  };
}

function createRoom(mode, seat0, seat1) {
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const players = [seat0, seat1].map((s, i) => ({
    id: s.userId || `bot_${i}`,
    name: s.displayName,
    avatar: s.avatar,
    isBot: s.isBot,
  }));
  const room = {
    id,
    mode,
    seats: [seat0, seat1],
    state: newRound(players, [0, 0], 1),
    botTimer: null,
    roundTimer: null,
    rematchVotes: new Set(),
    statsRecorded: false,
    finished: false,
  };
  games.set(id, room);
  room.seats.forEach((seat, i) => {
    if (seat.userId) roomByUser.set(seat.userId, { room, seat: i });
    seat.socket?.join(id);
  });
  return room;
}

function createOnlineGame(a, b) {
  const room = createRoom('online', makeSeat(a), makeSeat(b));
  io.to(room.id).emit('game:start', { mode: 'online' });
  sendState(room);
}

function createAiGame(entry) {
  const room = createRoom('ai', makeSeat(entry), makeSeat(null, true));
  room.seats[0].socket?.join(room.id);
  io.to(room.id).emit('game:start', { mode: 'ai' });
  sendState(room);
  maybeBotTurn(room);
}

// ------------------------------------------------------------
//  Estado personalizado por jogador
// ------------------------------------------------------------
function legalMap(state, p) {
  const map = {};
  for (const m of legalMoves(state, p)) {
    if (!map[m.tileId]) map[m.tileId] = [];
    if (m.side === 'any') {
      map[m.tileId] = ['left', 'right'];
    } else if (!map[m.tileId].includes(m.side)) {
      map[m.tileId].push(m.side);
    }
  }
  return map;
}

function buildState(room, seatIdx) {
  const s = room.state;
  const you = room.seats[seatIdx];
  const opp = room.seats[1 - seatIdx];
  const revealed = s.status !== 'playing';
  return {
    id: room.id,
    mode: room.mode,
    status: s.status,
    round: s.round,
    scores: s.scores,
    goal: GOAL_SCORE,
    turn: s.turn,
    openLeft: s.openLeft,
    openRight: s.openRight,
    chain: s.chain,
    boneyardCount: s.boneyardCount ?? s.boneyard.length,
    you: {
      index: seatIdx,
      name: you.displayName,
      avatar: you.avatar,
      hand: s.hands[seatIdx],
      pips: pipSum(s.hands[seatIdx]),
      isBot: you.isBot,
    },
    opp: {
      index: 1 - seatIdx,
      name: opp.displayName,
      avatar: opp.avatar,
      handCount: s.hands[1 - seatIdx].length,
      pips: revealed ? pipSum(s.hands[1 - seatIdx]) : null,
      isBot: opp.isBot,
      connected: opp.connected,
    },
    legal: legalMap(s, seatIdx),
    canDraw: canDraw(s, seatIdx),
    canPass: canPass(s, seatIdx),
    lastAction: s.lastAction,
    roundResult: s.roundResult,
    log: s.log.slice(-40),
    youIndex: seatIdx,
  };
}

function sendState(room) {
  room.seats.forEach((seat, i) => {
    if (seat.socket && seat.connected) {
      seat.socket.emit('game:state', buildState(room, i));
    }
  });
}

function sendEvent(room, event) {
  room.seats.forEach((seat) => {
    if (seat.socket && seat.connected) seat.socket.emit('game:event', event);
  });
}

// ------------------------------------------------------------
//  Fluxo de partida
// ------------------------------------------------------------
function afterAction(room) {
  const s = room.state;

  if (s.status === 'roundover') {
    sendEvent(room, {
      type: 'roundover',
      result: s.roundResult.type,
      winner: s.roundResult.winner,
      points: s.roundResult.points,
      scores: s.scores,
    });
    clearTimeout(room.roundTimer);
    room.roundTimer = setTimeout(() => {
      if (room.finished) return;
      room.state = nextRound(room.state);
      room.rematchVotes.clear();
      sendEvent(room, { type: 'roundstart', round: room.state.round });
      sendState(room);
      maybeBotTurn(room);
    }, ROUND_BREAK);
  } else if (s.status === 'matchover') {
    finishMatch(room);
  } else {
    maybeBotTurn(room);
  }
}

function finishMatch(room) {
  if (room.finished) return;
  room.finished = true;
  clearTimeout(room.botTimer);
  clearTimeout(room.roundTimer);

  if (!room.statsRecorded) {
    room.statsRecorded = true;
    const [w, l] = s_winnerLoser(room.state);
    if (room.mode === 'online') {
      const winnerSeat = room.seats[w];
      const loserSeat = room.seats[l];
      if (winnerSeat?.userId) store.recordResult(winnerSeat.userId, true, room.state.scores[w]);
      if (loserSeat?.userId) store.recordResult(loserSeat.userId, false, room.state.scores[l]);
    } else if (room.seats[0].userId) {
      const won = w === 0;
      store.recordResult(room.seats[0].userId, won, room.state.scores[won ? 0 : 1]);
    }
  }
  sendEvent(room, {
    type: 'matchover',
    winner: room.state.winner,
    winnerName: room.state.players[room.state.winner].name,
    scores: room.state.scores,
  });
}

function s_winnerLoser(state) {
  return state.winner === 0 ? [0, 1] : [1, 0];
}

function maybeBotTurn(room) {
  const s = room.state;
  if (room.finished || s.status !== 'playing') return;
  if (!s.players[s.turn].isBot) return;
  if (room.botTimer) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.finished || room.state.status !== 'playing') return;
    const bot = room.state.turn;
    try {
      const action = botAction(room.state, bot);
      applyAction(room, bot, action, true);
    } catch (err) {
      console.error('[bot]', err);
    }
  }, BOT_MIN_DELAY + Math.random() * (BOT_MAX_DELAY - BOT_MIN_DELAY));
}

function applyAction(room, seatIdx, action, isBot = false) {
  const s = room.state;
  let event;

  if (action.type === 'play') {
    playTile(s, seatIdx, action.tileId, action.side);
    event = { type: 'play', player: seatIdx, tileId: action.tileId, side: action.side };
  } else if (action.type === 'draw') {
    const tile = drawTile(s, seatIdx);
    event = { type: 'draw', player: seatIdx, tileId: tile.id };
  } else if (action.type === 'pass') {
    passTurn(s, seatIdx);
    event = { type: 'pass', player: seatIdx };
  } else {
    throw new Error('Ação desconhecida.');
  }

  sendEvent(room, event);
  sendState(room);
  afterAction(room);
}

function handleAction(socket, payload) {
  const ref = roomByUser.get(socket.data.user.id);
  const room = ref && games.has(ref.room.id) ? ref.room : null;
  if (!room) return socket.emit('game:error', { message: 'Você não está em uma partida.' });

  const seatIdx = room.seats.findIndex((st) => st.socket === socket);
  if (seatIdx < 0) return socket.emit('game:error', { message: 'Mesa não encontrada.' });
  if (room.state.turn !== seatIdx) return socket.emit('game:error', { message: 'Aguarde sua vez.' });

  try {
    applyAction(room, seatIdx, payload);
  } catch (err) {
    socket.emit('game:error', { message: err.message });
  }
}

function leaveRoom(userId, reason = 'leave') {
  const ref = roomByUser.get(userId);
  const room = ref?.room;
  if (!room || !games.has(room.id)) return;

  const seatIdx = room.seats.findIndex((st) => st.userId === userId);
  if (seatIdx < 0) return;

  const seat = room.seats[seatIdx];
  seat.socket = null;
  seat.connected = false;
  clearTimeout(seat.graceTimer);

  if (room.finished) {
    cleanupRoom(room);
    return;
  }

  clearTimeout(room.botTimer);
  clearTimeout(room.roundTimer);
  const s = room.state;

  if (s.status === 'playing') {
    // W.O.: quem saiu perde a partida
    try {
      forfeit(s, seatIdx);
    } catch { /* já encerrada */ }
    s.status = 'matchover';
    s.winner = 1 - seatIdx;
  } else if (s.status === 'roundover') {
    // Intervalo entre rodadas: quem fica com o placar vence
    s.status = 'matchover';
    s.winner = s.scores[0] > s.scores[1] ? 0
      : s.scores[1] > s.scores[0] ? 1
        : 1 - seatIdx;
  }

  sendEvent(room, { type: 'opponent_left', name: seat.displayName, reason });
  if (s.status === 'matchover') finishMatch(room);
  cleanupRoom(room);
}

function cleanupRoom(room) {
  room.finished = true;
  clearTimeout(room.botTimer);
  clearTimeout(room.roundTimer);
  room.seats.forEach((seat) => {
    clearTimeout(seat.graceTimer);
    if (seat.userId) roomByUser.delete(seat.userId);
  });
  games.delete(room.id);
}

function inRoom(userId) {
  const ref = roomByUser.get(userId);
  return ref && games.has(ref.room.id) ? ref : null;
}

// ------------------------------------------------------------
//  Socket.IO
// ------------------------------------------------------------
io.use((socket, next) => {
  const user = authenticateSocket(socket);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socketsByUser.set(user.id, socket);
  onlineUsers.add(user.id);
  broadcastOnline();
  socket.emit('hello', { user: store.publicUser(user) });

  // Reconexão: se estava em uma sala, religa
  const existing = roomByUser.get(user.id);
  if (existing && !games.has(existing.room.id)) {
    roomByUser.delete(user.id); // sala já encerrada
  } else if (existing) {
    const seat = existing.room.seats[existing.seat];
    clearTimeout(seat.graceTimer);
    seat.socket = socket;
    seat.connected = true;
    socket.join(existing.room.id);
    socket.emit('game:start', { mode: existing.room.mode, reconnect: true });
    sendState(existing.room);
    if (existing.room.state.status === 'roundover' || existing.room.state.status === 'matchover') {
      const s = existing.room.state;
      sendEvent(existing.room, s.status === 'matchover'
        ? { type: 'matchover', winner: s.winner, winnerName: s.players[s.winner].name, scores: s.scores }
        : {
            type: 'roundover',
            result: s.roundResult?.type,
            winner: s.roundResult?.winner,
            points: s.roundResult?.points,
            scores: s.scores,
          });
    }
    maybeBotTurn(existing.room);
  }

  socket.on('queue:join', () => joinQueue(socket, user));
  socket.on('queue:leave', () => leaveQueue(user.id));

  socket.on('game:vsai', () => {
    if (inRoom(user.id)) {
      socket.emit('game:error', { message: 'Você já está em uma partida.' });
      return;
    }
    leaveQueue(user.id);
    createAiGame({ userId: user.id, displayName: user.displayName, avatar: user.avatar, socket });
  });

  socket.on('game:action', (payload) => handleAction(socket, payload || {}));

  socket.on('game:leave', () => {
    leaveQueue(user.id);
    leaveRoom(user.id, 'leave');
  });

  socket.on('game:rematch', () => {
    const room = inRoom(user.id)?.room;
    if (!room || !room.finished) return;
    const seatIdx = room.seats.findIndex((st) => st.userId === user.id);
    room.rematchVotes.add(seatIdx);

    const botMode = room.mode === 'ai';
    const bothVoted = botMode
      ? room.rematchVotes.has(0)
      : room.rematchVotes.has(0) && room.rematchVotes.has(1);

    if (!bothVoted) {
      sendEvent(room, { type: 'rematch_pending', by: seatIdx });
      return;
    }

    // Nova partida
    room.finished = false;
    room.statsRecorded = false;
    room.rematchVotes.clear();
    const players = room.seats.map((s, i) => ({ id: s.userId || `bot_${i}`, name: s.displayName, avatar: s.avatar, isBot: s.isBot }));
    room.state = newRound(players, [0, 0], 1);
    sendEvent(room, { type: 'rematch_start' });
    sendState(room);
    maybeBotTurn(room);
  });

  socket.on('disconnect', () => {
    if (socketsByUser.get(user.id) === socket) socketsByUser.delete(user.id);
    onlineUsers.delete(user.id);
    leaveQueue(user.id);
    broadcastOnline();

    // dá tempo de reconectar antes de decretar W.O.
    const ref = roomByUser.get(user.id);
    if (ref && games.has(ref.room.id) && ref.room.seats[ref.seat].socket === socket) {
      const seat = ref.room.seats[ref.seat];
      seat.socket = null;
      seat.connected = false;
      clearTimeout(seat.graceTimer);
      seat.graceTimer = setTimeout(() => {
        if (seat.socket) return;
        leaveRoom(user.id, 'disconnect');
      }, RECONNECT_GRACE);
      const other = ref.room.seats[1 - ref.seat];
      other.socket?.emit('game:event', { type: 'opponent_reconnecting', graceMs: RECONNECT_GRACE });
    }
  });
});

// ------------------------------------------------------------
//  Static (produção) + start
// ------------------------------------------------------------
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Dominó Pro — servidor rodando. Inicie o client com "npm run client".');
  });
});

server.listen(PORT, () => {
  console.log(`🟢 Dominó Pro rodando em http://localhost:${PORT}`);
});
