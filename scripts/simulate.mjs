// Simulação headless: valida regras jogando milhares de partidas IA × IA.
// Uso: node scripts/simulate.mjs [partidas]
import { newRound, legalMoves, canDraw, canPass, playTile, drawTile, passTurn, pipSum } from '../server/src/game.js';
import { botAction } from '../server/src/ai.js';

const GAMES = Number(process.argv[2] || 2000);
const players = [
  { id: 'a', name: 'A', avatar: '🦊' },
  { id: 'b', name: 'B', avatar: '🐼' },
];

let errors = 0;
let roundsTotal = 0;
let maxRounds = 0;
let blockages = 0;
let dominoes = 0;

function assert(cond, msg) {
  if (!cond) { errors++; if (errors < 10) console.error('✗', msg); }
}

function validate(state, tag) {
  const ids = new Set();
  for (const t of state.chain) {
    assert(!ids.has(t.id), `${tag}: peça duplicada no tabuleiro ${t.id}`);
    ids.add(t.id);
  }
  for (let i = 1; i < state.chain.length; i++) {
    assert(state.chain[i - 1].b === state.chain[i].a,
      `${tag}: cadeia rompida em ${i}: ${state.chain[i - 1].b} != ${state.chain[i].a}`);
  }
  if (state.chain.length) {
    assert(state.openLeft === state.chain[0].a, `${tag}: openLeft errado`);
    assert(state.openRight === state.chain[state.chain.length - 1].b, `${tag}: openRight errado`);
  }
  const all = [...state.hands[0], ...state.hands[1], ...state.boneyard, ...state.chain];
  assert(all.length === 28, `${tag}: total de peças = ${all.length}, esperado 28`);
  const seen = new Set(all.map((t) => t.id));
  assert(seen.size === 28, `${tag}: peças únicas = ${seen.size}`);
  assert(state.scores.every((s) => s >= 0), `${tag}: placar negativo`);
}

for (let g = 0; g < GAMES; g++) {
  const players2 = players.map((p) => ({ ...p, isBot: true }));
  let state = newRound(players2, [0, 0], 1);
  let rounds = 0;

  while (state.status !== 'matchover') {
    rounds++;
    assert(rounds < 500, 'rodada não termina');
    if (rounds > 500) break;

    let guard = 0;
    while (state.status === 'playing') {
      guard++;
      assert(guard < 3000, 'loop infinito no turno');
      if (guard > 3000) break;

      const p = state.turn;
      const action = botAction(state, p);
      try {
        if (action.type === 'play') {
          playTile(state, p, action.tileId, action.side);
        } else if (action.type === 'draw') {
          assert(canDraw(state, p), 'bot comprou sem direito');
          drawTile(state, p);
        } else if (action.type === 'pass') {
          assert(canPass(state, p), 'bot passou sem direito');
          passTurn(state, p);
        }
      } catch (err) {
        errors++;
        console.error('✗ ação inválida:', action, err.message);
        state.status = 'matchover';
        break;
      }
      validate(state, `game ${g} r${rounds}`);
    }

    if (state.status === 'roundover') {
      roundsTotal++;
      if (state.roundResult.type === 'blockage') blockages++;
      if (state.roundResult.type === 'domino') dominoes++;
      // relança a rodada mantendo o placar
      const { nextRound } = await import('../server/src/game.js');
      state = nextRound(state);
      if (state.round > 60) break; // segurança
    } else if (state.status === 'matchover') {
      roundsTotal++;
      break;
    }
  }
  maxRounds = Math.max(maxRounds, rounds);
}

console.log('────────────────────────────────────────');
console.log(`Partidas simuladas : ${GAMES}`);
console.log(`Rodadas totais     : ${roundsTotal}`);
console.log(`Fim por fechamento : ${dominoes} (${((dominoes / roundsTotal) * 100).toFixed(1)}%)`);
console.log(`Fim por bloqueio   : ${blockages} (${((blockages / roundsTotal) * 100).toFixed(1)}%)`);
console.log(`Máx. rodadas/part. : ${maxRounds}`);
console.log(`Erros              : ${errors}`);
console.log(errors === 0 ? '✅ ENGINE OK' : '❌ ENGINE COM PROBLEMAS');
process.exit(errors === 0 ? 0 : 1);
