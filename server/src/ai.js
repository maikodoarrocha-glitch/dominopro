// ============================================================
//  Dominó Pro — IA (bot)
//  Heurística: maximiza jogadas futuras, prefere descartar
//  peças pesadas, joga duplas cedo e tenta bloquear o rival.
// ============================================================

import { legalMoves, canDraw, canPass, pipSum } from './game.js';

function countValue(tiles, v) {
  return tiles.reduce((n, t) => n + (t.a === v ? 1 : 0) + (t.b === v ? 1 : 0), 0);
}

/** Quantas cópias do valor `v` ainda estão fora da mão do bot. */
function unseenCopies(state, bot, v) {
  const total = 7 + v; // no conjunto duplo-seis
  let mine = countValue(state.hands[bot], v);
  let board = 0;
  for (const t of state.chain) {
    board += (t.a === v ? 1 : 0) + (t.b === v ? 1 : 0);
  }
  return Math.max(0, total - mine - board);
}

function scoreMove(state, bot, move, opponentPassed) {
  const tile = state.hands[bot].find((t) => t.id === move.tileId);
  const hand = state.hands[bot];
  let score = Math.random() * 2; // desempate suave

  // Encerrar a mão é sempre o melhor lance
  if (hand.length === 1) return 100000;

  // Valor que ficará aberto após jogar
  let openAfter;
  if (state.chain.length === 0 || move.side === 'any') {
    openAfter = tile.a === tile.b ? tile.a : null; // abertura dobra os dois lados
  } else if (move.side === 'left') {
    openAfter = tile.b === state.openLeft ? tile.a : tile.b;
  } else {
    openAfter = tile.a === state.openRight ? tile.b : tile.a;
  }

  if (openAfter !== null) {
    // Quantas peças minhas usam esse valor (continuidade)
    const myFuture = countValue(hand, openAfter) - (tile.a === openAfter ? 1 : 0) - (tile.b === openAfter ? 1 : 0);
    score += myFuture * 12;

    // Bloqueio: poucas cópias vistas fora da minha mão = rival provavelmente não tem
    const unseen = unseenCopies(state, bot, openAfter);
    score += (10 - unseen) * 2;
    if (unseen === 0) score += 40; // valor "morto" para o rival
  }

  // Descartar peças pesadas reduz o risco de levar ponto no bloqueio
  score += (tile.a + tile.b) * 1.5;

  // Duplas ficam difíceis de encaixar depois: jogue cedo
  if (tile.a === tile.b) score += 6;

  // Se o rival passou na última vez, ele está sem certos valores: priorize bloqueio
  if (opponentPassed) score += (openAfter !== null ? (10 - unseenCopies(state, bot, openAfter)) * 3 : 0);

  return score;
}

/**
 * Decide a ação do bot.
 * @returns {type:'play', tileId, side} | {type:'draw'} | {type:'pass'}
 */
export function botAction(state, bot) {
  const moves = legalMoves(state, bot);
  if (moves.length > 0) {
    const opponentPassed = state.lastAction?.type === 'pass' && state.lastAction.player !== bot;

    // agrupa movimentos por peça (escolhe melhor lado por peça)
    const byTile = new Map();
    for (const m of moves) {
      const prev = byTile.get(m.tileId);
      if (!prev) byTile.set(m.tileId, [m]);
      else prev.push(m);
    }

    let best = null;
    let bestScore = -Infinity;
    for (const [tileId, tileMoves] of byTile) {
      for (const m of tileMoves) {
        const s = scoreMove(state, bot, m, opponentPassed);
        if (s > bestScore) { bestScore = s; best = m; }
      }
    }
    return { type: 'play', tileId: best.tileId, side: best.side };
  }

  if (canDraw(state, bot)) return { type: 'draw' };
  if (canPass(state, bot)) return { type: 'pass' };
  return { type: 'play', tileId: null, side: null }; // nunca deveria acontecer
}

/** Resumo da mão (para debug/logs). */
export function describeHand(state, p) {
  return pipSum(state.hands[p]);
}
