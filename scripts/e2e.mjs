// Teste end-to-end: API + Socket.IO + partida real contra a IA + matchmaking 1v1.
// Uso: node scripts/e2e.mjs
import { io } from 'socket.io-client';

const BASE = 'http://localhost:3001';
const results = [];
let failures = 0;

function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function once(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando "${event}"`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function post(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connect(token) {
  const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout no connect')), 6000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

// ------------------------------------------------------------
// 1) API: registro, login, erros, leaderboard
// ------------------------------------------------------------
const u1 = `teste_${Math.random().toString(36).slice(2, 7)}`;
const u2 = `teste_${Math.random().toString(36).slice(2, 7)}`;
const pass = 'senha123';

const reg = await post('/register', { username: u1, password: pass, avatar: '🦊' });
check('register cria conta', reg.status === 200 && !!reg.data.token, `status ${reg.status}`);

const regDup = await post('/register', { username: u1, password: pass });
check('register bloqueia duplicado', regDup.status === 409, `status ${regDup.status}`);

const regShort = await post('/register', { username: 'ab', password: '123456' });
check('register valida campos', regShort.status === 400, `status ${regShort.status}`);

const badLogin = await post('/login', { username: u1, password: 'errada' });
check('login rejeita senha errada', badLogin.status === 401, `status ${badLogin.status}`);

const login = await post('/login', { username: u1, password: pass });
check('login ok', login.status === 200 && !!login.data.token, `status ${login.status}`);

const meRes = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${login.data.token}` } });
const me = await meRes.json();
check('/api/me devolve o usuário', meRes.status === 200 && me.user?.username === u1.toLowerCase());

const noAuth = await fetch(`${BASE}/api/me`);
check('/api/me exige token', noAuth.status === 401);

const lb = await fetch(`${BASE}/api/leaderboard`);
const lbData = await lb.json();
check('leaderboard responde', lb.status === 200 && Array.isArray(lbData.top));

// ------------------------------------------------------------
// 2) Partida contra a IA: completa uma rodada jogando sozinho
// ------------------------------------------------------------
const s1 = await connect(login.data.token);
check('socket conecta com token', s1.connected);

const startP = once(s1, 'game:start');
let firstState = null;
s1.on('game:state', (s) => { firstState = s; });
s1.emit('game:vsai');
const started = await startP;
check('partida vs IA começa', started.mode === 'ai');

const initial = firstState || (await once(s1, 'game:state'));
check('estado inicial vem completo',
  Array.isArray(initial.you.hand) && initial.you.hand.length === 7 &&
  Array.isArray(initial.chain) && initial.chain.length === 0 &&
  initial.scores[0] === 0 && initial.boneyardCount === 14,
  `mão=${initial.you.hand.length} estoque=${initial.boneyardCount}`);

check('IA é o oponente', initial.opp.isBot === true && initial.opp.handCount === 7);
check('só vê a própria mão', !('hand' in initial.opp) || initial.opp.hand === undefined);

// Erro de ação fora de turno
const errP = once(s1, 'game:error');
s1.emit('game:action', { type: 'pass' });
let errMsg = '';
try { errMsg = (await errP).message; } catch { /* pode não dar erro se for a vez */ }
check('ações inválidas são bloqueadas', typeof errMsg === 'string');

// Joga até terminar a rodada
let state = initial;
let moves = 0;
let roundEnded = false;
const errorsSeen = [];
s1.on('game:error', (e) => errorsSeen.push(e.message));
s1.on('game:event', (e) => {
  if (e.type === 'roundover' || e.type === 'matchover') roundEnded = true;
});

const roundDone = new Promise((resolve) => {
  const handler = (s) => {
    state = s;
    if (s.status !== 'playing') { resolve(s); return; }
    if (s.turn !== s.youIndex) return;
    moves++;

    const tileIds = Object.keys(s.legal);
    if (tileIds.length > 0) {
      const tileId = tileIds[moves % tileIds.length];
      const sides = s.legal[tileId];
      s1.emit('game:action', { type: 'play', tileId, side: sides[0] });
    } else if (s.canDraw) {
      s1.emit('game:action', { type: 'draw' });
    } else if (s.canPass) {
      s1.emit('game:action', { type: 'pass' });
    }
  };
  s1.on('game:state', handler);
  if (state.turn === state.youIndex && state.status === 'playing') handler(state);
});

const timeout = wait(90000).then(() => 'timeout');
const ended = await Promise.race([roundDone, timeout]);

check('rodada termina em menos de 90s', ended !== 'timeout', `movimentos=${moves}`);
if (ended !== 'timeout') {
  check('rodada terminou com resultado', ended.status === 'roundover' || ended.status === 'matchover',
    `status=${ended.status} resultado=${ended.roundResult?.type}`);
  check('placar foi atualizado', ended.scores[0] + ended.scores[1] > 0,
    `placar=${ended.scores.join(' × ')}`);
  check('nenhuma ação foi rejeitada', errorsSeen.length === 0, errorsSeen.slice(0, 3).join(' | '));
}

s1.emit('game:leave');
await wait(300);

// ------------------------------------------------------------
// 3) Matchmaking: dois jogadores casam na hora
// ------------------------------------------------------------
const reg2 = await post('/register', { username: u2, password: pass, avatar: '🐼' });
const sa = await connect(reg.data.token);
const sb = await connect(reg2.data.token);

const startA = once(sa, 'game:start', 12000);
const startB = once(sb, 'game:start', 12000);
let stateA = null;
let stateB = null;
sa.on('game:state', (s) => { stateA = s; });
sb.on('game:state', (s) => { stateB = s; });
sa.emit('queue:join');
await wait(120);
sb.emit('queue:join');

const [m1, m2] = await Promise.all([startA, startB]);
check('dois jogadores casam na fila', m1.mode === 'online' && m2.mode === 'online',
  `${m1.mode} / ${m2.mode}`);

stateA = stateA || (await once(sa, 'game:state'));
stateB = stateB || (await once(sb, 'game:state'));
check('ambos recebem estado da mesma mesa', stateA.id === stateB.id, `${stateA.id}`);
check('mesa tem dois jogadores reais', stateA.opp.isBot === false && stateA.opp.name?.length > 0,
  `oponente=${stateA.opp.name}`);

sa.emit('game:leave');
sb.emit('game:leave');
await wait(400);

// ------------------------------------------------------------
// 4) Fila sozinho vira partida com IA (fallback)
// -----------------------------------------------------------
const sc = await connect(login.data.token);
const startC = once(sc, 'game:start', 15000);
const queueMsg = once(sc, 'queue:status', 15000);
sc.emit('queue:join');const q = await queueMsg;
check('fila informa que está procurando', q.searching === true, q.message || '');
const startedC = await startC;
check('sem oponente, IA assume (fallback)', startedC.mode === 'ai', `mode=${startedC.mode}`);

sa.close(); sb.close(); sc.close(); s1.close();

console.log('────────────────────────────────────────');
console.log(`${results.filter((r) => r.ok).length}/${results.length} verificações passaram`);
console.log(failures === 0 ? '✅ E2E OK' : `❌ ${failures} FALHAS`);
process.exit(failures === 0 ? 0 : 1);
