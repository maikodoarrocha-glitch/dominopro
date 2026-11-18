// ============================================================
//  Dominó Pro — Engine de jogo (regras do dominó 1v1)
//  Conjunto duplo-seis: 28 peças, 7 peças por jogador.
// ============================================================

export const GOAL_SCORE = 61; // primeira a chegar vence a partida
export const HAND_SIZE = 7;

/** Cria o baralho duplo-seis: [0-0] ... [6-6] (28 peças). */
export function createDeck() {
  const deck = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      deck.push({ id: `${a}-${b}`, a, b });
    }
  }
  return deck;
}

export function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pipSum(tiles) {
  return tiles.reduce((s, t) => s + t.a + t.b, 0);
}

/** Abre uma nova rodada. `players` = [{id, name, avatar, isBot}]. */
export function newRound(players, scores, round) {
  const deck = shuffle(createDeck());
  const hands = [deck.splice(0, HAND_SIZE), deck.splice(0, HAND_SIZE)];

  // Quem tem a maior dupla começa; aleatório se ninguém tiver (peça na mesa).
  let start = Math.random() < 0.5 ? 0 : 1;
  let best = -1;
  hands.forEach((hand, i) => {
    for (const t of hand) {
      if (t.a === t.b && t.a > best) { best = t.a; start = i; }
    }
  });

  const state = {
    players,
    hands,
    boneyard: deck,
    chain: [],           // [{id, a, b}] orientado: a = ponta esquerda, b = ponta direita
    openLeft: null,
    openRight: null,
    turn: start,
    passes: 0,           // passadas consecutivas
    scores: scores.slice(),
    round,
    status: 'playing',   // 'playing' | 'roundover' | 'matchover'
    winner: null,
    roundResult: null,   // {type:'domino'|'blockage'|'forfeit', winner, points}
    log: [],
    lastAction: null,
  };
  state.log.push({ type: 'round', round, text: `Rodada ${round} — boa sorte!` });
  return state;
}

/** Movimentos legais de um jogador. */
export function legalMoves(state, p) {
  if (state.status !== 'playing' || state.turn !== p) return [];
  const hand = state.hands[p];
  const moves = [];
  if (state.chain.length === 0) {
    // Abertura: qualquer peça pode ser jogada
    for (const t of hand) moves.push({ tileId: t.id, side: 'any' });
    return moves;
  }
  for (const t of hand) {
    if (t.a === state.openLeft || t.b === state.openLeft) moves.push({ tileId: t.id, side: 'left' });
    if (t.a === state.openRight || t.b === state.openRight) moves.push({ tileId: t.id, side: 'right' });
  }
  // uma peça pode valer para os dois lados — ambos os movimentos são retornados
  return moves;
}

/** Pode comprar do estoque? Só quando não há jogadas. */
export function canDraw(state, p) {
  return state.status === 'playing' && state.turn === p &&
    legalMoves(state, p).length === 0 && state.boneyard.length > 0;
}

/** Pode passar? Só quando não há jogadas e o estoque acabou. */
export function canPass(state, p) {
  return state.status === 'playing' && state.turn === p &&
    legalMoves(state, p).length === 0 && state.boneyard.length === 0;
}

function orientForSide(tile, side, openLeft, openRight) {
  if (side === 'any') return { id: tile.id, a: tile.a, b: tile.b };
  if (side === 'left') {
    // lado direito da peça encosta na ponta esquerda do tabuleiro
    if (tile.b === openLeft) return { id: tile.id, a: tile.a, b: tile.b };
    if (tile.a === openLeft) return { id: tile.id, a: tile.b, b: tile.a };
    return null;
  }
  // side === 'right'
  if (tile.a === openRight) return { id: tile.id, a: tile.a, b: tile.b };
  if (tile.b === openRight) return { id: tile.id, a: tile.b, b: tile.a };
  return null;
}

function finishRound(state, winner, type) {
  const loser = winner === 0 ? 1 : 0;
  let points = 0;
  if (type === 'blockage') {
    const w = pipSum(state.hands[winner]);
    const l = pipSum(state.hands[loser]);
    points = Math.max(0, l - w);
  } else if (type === 'forfeit') {
    points = pipSum(state.hands[loser]);
  } else {
    points = pipSum(state.hands[loser]); // "capote": soma da mão do perdedor
  }
  state.scores[winner] += points;
  state.status = state.scores[winner] >= GOAL_SCORE ? 'matchover' : 'roundover';
  state.winner = winner;
  state.roundResult = { type, winner, points };
  state.log.push({
    type: 'result',
    winner,
    text:
      type === 'blockage'
        ? `Bloqueio! ${state.players[winner].name} vence a rodada (+${points})`
        : `${state.players[winner].name} fechou a mão (+${points})`,
  });
}

/** Joga uma peça. Lança Error em jogada inválida. */
export function playTile(state, p, tileId, side) {
  if (state.status !== 'playing') throw new Error('A rodada acabou.');
  if (state.turn !== p) throw new Error('Não é a sua vez.');
  const moves = legalMoves(state, p);
  const candidates = moves.filter((m) => m.tileId === tileId);
  if (candidates.length === 0) throw new Error('Essa peça não pode ser jogada agora.');

  let sideToUse;
  if (candidates.length === 1) {
    sideToUse = candidates[0].side;
  } else {
    const exact = candidates.find((m) => m.side === side) ||
      (side === 'any' ? candidates[0] : null);
    if (!exact) throw new Error('Essa peça não pode ser jogada aí.');
    sideToUse = exact.side;
  }

  const idx = state.hands[p].findIndex((t) => t.id === tileId);
  if (idx < 0) throw new Error('Você não tem essa peça.');
  const tile = state.hands[p][idx];

  if (state.chain.length === 0) {
    state.hands[p].splice(idx, 1);
    const oriented = { id: tile.id, a: tile.a, b: tile.b };
    state.chain.push(oriented);
    state.openLeft = oriented.a;
    state.openRight = oriented.b;
  } else {
    const oriented = orientForSide(tile, sideToUse, state.openLeft, state.openRight);
    if (!oriented) throw new Error('Essa peça não encaixa aí.');
    state.hands[p].splice(idx, 1);
    if (sideToUse === 'left') {
      state.chain.unshift(oriented);
      state.openLeft = oriented.a;
    } else {
      state.chain.push(oriented);
      state.openRight = oriented.b;
    }
  }

  state.passes = 0;
  state.lastAction = { type: 'play', player: p, tileId, side: sideToUse };
  state.log.push({
    type: 'play',
    player: p,
    text: `${state.players[p].name} jogou ${tileId.replace('-', '–')}`,
  });

  if (state.hands[p].length === 0) {
    finishRound(state, p, 'domino');
    return { ended: true };
  }

  state.turn = 1 - p;
  return { ended: false };
}

/** Compra 1 peça do estoque (só quando não há jogadas). */
export function drawTile(state, p) {
  if (!canDraw(state, p)) throw new Error('Não é possível comprar agora.');
  const tile = state.boneyard.pop();
  state.hands[p].push(tile);
  state.lastAction = { type: 'draw', player: p };
  state.log.push({ type: 'draw', player: p, text: `${state.players[p].name} comprou uma peça` });
  return tile;
}

/** Passa a vez (só quando não há jogadas e o estoque acabou). */
export function passTurn(state, p) {
  if (!canPass(state, p)) throw new Error('Você ainda pode jogar ou comprar.');
  state.passes += 1;
  state.lastAction = { type: 'pass', player: p };
  state.log.push({ type: 'pass', player: p, text: `${state.players[p].name} passou` });
  if (state.passes >= 2) {
    // Bloqueio: vence quem tem menos pontos na mão
    const s0 = pipSum(state.hands[0]);
    const s1 = pipSum(state.hands[1]);
    const winner = s0 <= s1 ? 0 : 1;
    finishRound(state, winner, 'blockage');
    return { ended: true };
  }
  state.turn = 1 - p;
  return { ended: false };
}

/** Desiste da rodada (desconexão/vitória por W.O.). */
export function forfeit(state, p) {
  if (state.status !== 'playing') return;
  finishRound(state, 1 - p, 'forfeit');
}

/** Inicia a próxima rodada mantendo o placar. */
export function nextRound(state) {
  return newRound(state.players, state.scores, state.round + 1);
}
