// ============================================================
//  gameBus — ponte entre o socket e a tela de jogo
//  Evita perder o primeiro estado/evento enquanto a tela monta.
// ============================================================
let state = null;
let queue = [];
const listeners = new Set();

export const gameBus = {
  setState(s) {
    state = s;
    listeners.forEach((l) => l({ type: 'state', data: s }));
  },
  pushEvent(e) {
    if (listeners.size === 0) {
      queue.push(e);
      return;
    }
    listeners.forEach((l) => l({ type: 'event', data: e }));
  },
  getState() {
    return state;
  },
  drain() {
    const q = queue;
    queue = [];
    return q;
  },
  reset() {
    state = null;
    queue = [];
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Gancho de depuração (permite testar layouts com estados grandes no navegador)
if (typeof window !== 'undefined') {
  window.__domino = { gameBus };
}
