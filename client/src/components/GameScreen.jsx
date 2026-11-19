import React, { useEffect, useRef, useState } from 'react';
import { gameBus } from '../gameBus.js';
import { getSocket } from '../socket.js';
import { sound } from '../sound.js';
import Tile from './Tile.jsx';

const ROUND_BREAK = 6; // segundos exibidos entre rodadas

export default function GameScreen({ onLeave, onToggleMute, muted, toast }) {
  const [st, setSt] = useState(() => gameBus.getState());
  const [pending, setPending] = useState(null);
  const [modal, setModal] = useState(null);
  const [countdown, setCountdown] = useState(ROUND_BREAK);
  const [rematchSent, setRematchSent] = useState(false);

  const stRef = useRef(st);
  stRef.current = st;
  const socketRef = useRef(getSocket());
  const tileRefs = useRef({});
  const handRef = useRef(null);

  const yourTurn = !!st && st.turn === st.youIndex && st.status === 'playing';

  function syncModal(s) {
    if (!s) return;
    if (s.status === 'playing') {
      setModal((m) => (m ? null : m));
      setRematchSent(false);
    } else if (s.status === 'roundover' && s.roundResult) {
      setModal({
        type: 'round',
        result: s.roundResult.type,
        winner: s.roundResult.winner,
        points: s.roundResult.points,
      });
    } else if (s.status === 'matchover') {
      setModal((m) => (m?.type === 'match' ? m : { type: 'match', winner: s.winner }));
    }
  }

  function applyState(s) {
    setSt(s);
    syncModal(s);
  }

  function handleEvent(ev) {
    const cur = stRef.current;
    switch (ev.type) {
      case 'play': {
        sound.play();
        if (cur && ev.player !== cur.youIndex) {
          toast(`${cur.opp.name} jogou ${String(ev.tileId).replace('-', '–')}`, 'info');
        }
        break;
      }
      case 'draw': {
        sound.draw();
        if (cur && ev.player !== cur.youIndex) toast(`${cur.opp.name} comprou uma peça`, 'info');
        break;
      }
      case 'pass': {
        sound.pass();
        if (cur) {
          toast(ev.player === cur.youIndex ? 'Você passou a vez.' : `${cur.opp.name} passou a vez.`, 'warn');
        }
        break;
      }
      case 'roundover':
        sound.roundEnd();
        setModal({ type: 'round', result: ev.result, winner: ev.winner, points: ev.points });
        setCountdown(ROUND_BREAK);
        break;
      case 'roundstart':
        setModal(null);
        toast(`Rodada ${ev.round} — sua vez pode começar.`, 'good');
        break;
      case 'matchover':
        if (cur && ev.winner === cur.youIndex) sound.win();
        else sound.lose();
        setModal({ type: 'match', winner: ev.winner });
        break;
      case 'rematch_start':
        setModal(null);
        setRematchSent(false);
        toast('Nova partida iniciada!', 'good');
        break;
      case 'rematch_pending':
        if (ev.by !== stRef.current?.youIndex) {
          toast('Oponente pediu revanche — aproveite para aceitar também.', 'warn');
        } else {
          toast('Aguardando oponente aceitar a revanche…', 'info');
        }
        break;
      case 'opponent_left':
        toast(`${ev.name} saiu da partida.`, 'warn');
        break;
      case 'opponent_reconnecting':
        toast('Oponente desconectou — aguardando reconexão…', 'warn');
        break;
      default:
        break;
    }
  }

  // Assina o barramento e drena eventos que chegaram antes da tela montar
  useEffect(() => {
    const off = gameBus.subscribe((msg) => {
      if (msg.type === 'state') applyState(msg.data);
      else handleEvent(msg.data);
    });
    const initial = gameBus.getState();
    if (initial) applyState(initial);
    gameBus.drain().forEach(handleEvent);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contagem regressiva entre rodadas
  useEffect(() => {
    if (modal?.type !== 'round') return;
    setCountdown(ROUND_BREAK);
    const t = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [modal?.type, modal?.winner]);

  // Rola a mesa até a última peça jogada
  useEffect(() => {
    const id = st?.lastAction?.type === 'play' ? st.lastAction.tileId : null;
    const el = id ? tileRefs.current[id] : null;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [st?.chain?.length, st?.lastAction?.tileId]);

  // (auto-scroll da mão desativado: a mão agora se adapta em várias linhas, sem rolagem)
  // eslint-disable-next-line no-unused-vars
  const _handAutoScrollDisabled = true;

  const emit = (payload) => socketRef.current.emit('game:action', payload);

  const doPlay = (tileId, side) => {
    sound.click();
    setPending(null);
    emit({ type: 'play', tileId, side });
  };

  const onHandTile = (tile) => {
    if (!yourTurn) {
      toast(st?.turn === st?.youIndex ? 'A rodada acabou.' : 'Aguarde sua vez.', 'warn');
      return;
    }
    const sides = st.legal[tile.id];
    if (!sides || sides.length === 0) {
      toast('Essa peça não encaixa nas pontas agora.', 'warn');
      sound.pass();
      return;
    }
    if (st.chain.length === 0 || sides.length === 1) {
      doPlay(tile.id, sides[0]);
      return;
    }
    setPending({ tileId: tile.id, sides });
    sound.click();
  };

  const handleLeave = () => {
    sound.click();
    socketRef.current.emit('game:leave');
    onLeave();
  };

  if (!st) {
    return (
      <div className="game-connecting">
        <div className="spinner spinner-lg" />
        <p>Montando a mesa…</p>
      </div>
    );
  }

  const hand = st.you.hand.slice().sort((x, y) => x.a - y.a || x.b - y.b);
  const oppTurn = st.turn === st.opp.index && st.status === 'playing';
  const revealed = st.status !== 'playing';
  const lastPlayed = st.lastAction?.type === 'play' ? st.lastAction.tileId : null;

  const resultTitle =
    modal?.result === 'blockage' ? '🚫 Bloqueio!'
      : modal?.result === 'forfeit' ? '🏳️ W.O.'
        : '🁫 Fechou a mão!';

  return (
    <div className="game">
      <header className="topbar game-topbar">
        <button className="btn btn-ghost btn-sm" onClick={handleLeave}>← Sair</button>
        <div className="logo logo-sm"><span className="logo-dot" /> Dominó <em>Pro</em></div>
        <div className="game-top-right">
          <span className="round-pill">Rodada {st.round} · até {st.goal}</span>
          <button className="icon-btn" onClick={onToggleMute} title={muted ? 'Ativar som' : 'Silenciar'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <div className="game-layout">
        <div className="game-main">
          {/* ---------- Oponente ---------- */}
          <div className={`player-strip ${oppTurn ? 'is-turn' : ''}`}>
            <div className="player-id">
              <span className="user-avatar">{st.opp.avatar}</span>
              <div className="player-meta">
                <b>{st.opp.name}</b>
                <span className="player-sub">
                  {st.opp.isBot ? '🤖 Inteligência artificial' : (st.opp.connected ? 'Conectado' : 'Desconectado')}
                </span>
              </div>
            </div>
            <div className="opponent-hand" title={`${st.opp.handCount} peças`}>
              {Array.from({ length: Math.min(st.opp.handCount, 15) }).map((_, i) => (
                <Tile key={i} back size="mini" dir="h" />
              ))}
              <span className="hand-count">{st.opp.handCount}</span>
            </div>
            <div className="player-score">{st.scores[st.opp.index]}</div>
          </div>

          {/* ---------- Mesa ---------- */}
          <section className="table">
            <div className="table-frame">
              <div className="table-felt">
                {st.chain.length === 0 ? (
                  <div className="chain-empty">
                    <Tile a={6} b={6} dir="v" size="board" className="chain-empty-tile" />
                    <span>Abra a partida com qualquer peça</span>
                  </div>
                ) : (
                  <div className="chain">
                    {st.chain.map((t) => (
                      <div
                        key={t.id}
                        className={`chain-cell ${lastPlayed === t.id ? 'chain-cell-new' : ''}`}
                        ref={(el) => { if (el) tileRefs.current[t.id] = el; }}
                      >
                        <Tile
                          a={t.a}
                          b={t.b}
                          dir={t.a === t.b ? 'v' : 'h'}
                          size="board"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="table-meta">
              <span>📦 Estoque: <b>{st.boneyardCount}</b> peças</span>
              <span>🔗 Pontas: <b>{st.openLeft ?? '–'}</b> / <b>{st.openRight ?? '–'}</b></span>
              <span>✋ Suas peças: <b>{st.you.hand.length}</b></span>
            </div>
          </section>

          {/* ---------- Você ---------- */}
          <div className={`player-strip me-strip ${yourTurn ? 'is-turn' : ''}`}>
            <div className="player-id">
              <span className="user-avatar">{st.you.avatar}</span>
              <div className="player-meta">
                <b>{st.you.name} <span className="you-tag">(você)</span></b>
                <span className="player-sub">{yourTurn ? '✨ Sua vez!' : st.status === 'playing' ? 'Aguardando…' : 'Rodada encerrada'}</span>
              </div>
            </div>
            <div className="your-score">{st.scores[st.youIndex]}</div>
          </div>

          <div className="hand" role="list" ref={handRef}>
            {hand.map((t) => {
              const sides = st.legal[t.id] || [];
              const playable = yourTurn && sides.length > 0;
              return (
                <div key={t.id} className={`hand-slot ${playable ? 'playable' : ''} ${pending?.tileId === t.id ? 'selected' : ''}`}>
                  <Tile
                    a={t.a}
                    b={t.b}
                    dir={t.a === t.b ? 'v' : 'h'}
                    size="hand"
                    onClick={() => onHandTile(t)}
                    title={playable ? 'Jogar' : 'Sem encaixe'}
                  />
                </div>
              );
            })}
          </div>

          <div className="controls">
            <button
              className="btn btn-secondary"
              disabled={!st.canDraw}
              onClick={() => { sound.click(); emit({ type: 'draw' }); }}
              title={st.canDraw ? 'Comprar 1 peça' : 'Só compra quando não há jogadas'}
            >
              📦 Comprar <span className="btn-badge">{st.boneyardCount}</span>
            </button>
            <div className="turn-hint">
              {yourTurn ? 'Jogue uma peça encaixando os números iguais' :
                st.status === 'playing' ? `Vez de ${st.opp.name}…` : 'Aguarde a próxima rodada'}
            </div>
            <button
              className="btn btn-ghost"
              disabled={!st.canPass}
              onClick={() => { sound.click(); emit({ type: 'pass' }); }}
              title={st.canPass ? 'Passar a vez' : 'Só passa quando o estoque acabou e não há jogadas'}
            >
              ⏭ Passar
            </button>
          </div>
        </div>

        {/* ---------- Painel lateral ---------- */}
        <aside className="game-side">
          <div className="card score-card">
            <h3>Placar <span className="muted">(meta {st.goal})</span></h3>
            <div className={`score-row ${st.turn === st.youIndex && st.status === 'playing' ? 'is-turn' : ''}`}>
              <span className="user-avatar sm">{st.you.avatar}</span>
              <span className="score-name">{st.you.name}</span>
              <b className="score-num">{st.scores[st.youIndex]}</b>
            </div>
            <div className={`score-row ${st.turn === st.opp.index && st.status === 'playing' ? 'is-turn' : ''}`}>
              <span className="user-avatar sm">{st.opp.avatar}</span>
              <span className="score-name">{st.opp.name}</span>
              <b className="score-num">{st.scores[st.opp.index]}</b>
            </div>
            {revealed && (
              <div className="revealed-hands">
                <div>Mão do oponente: <b>{st.opp.pips}</b> pts</div>
                <div>Sua mão: <b>{st.you.pips}</b> pts</div>
              </div>
            )}
          </div>

          <div className="card log-card">
            <h3>Andamento</h3>
            <ul className="log">
              {st.log.slice().reverse().map((entry, i) => (
                <li key={`${st.log.length}-${i}`} className={`log-${entry.type}`}>
                  {entry.text}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {/* ---------- Escolha de lado ---------- */}
      {pending && (
        <div className="pending-bar">
          <span>Jogar <b>{pending.tileId.replace('-', '–')}</b> em qual ponta?</span>
          {pending.sides.includes('left') && (
            <button className="btn btn-primary" onClick={() => doPlay(pending.tileId, 'left')}>
              ◀ Esquerda
            </button>
          )}
          {pending.sides.includes('right') && (
            <button className="btn btn-primary" onClick={() => doPlay(pending.tileId, 'right')}>
              Direita ▶
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setPending(null)}>Cancelar</button>
        </div>
      )}

      {/* ---------- Modais ---------- */}
      {modal && (
        <div className="overlay">
          <div className="modal">
            {modal.type === 'round' ? (
              <>
                <div className="modal-emoji">
                  {modal.winner === st.youIndex ? '🎉' : '😤'}
                </div>
                <h2>{resultTitle}</h2>
                <p>
                  {modal.winner === st.youIndex ? 'Você venceu' : `${st.opp.name} venceu`} a rodada
                  {modal.points > 0 ? <> com <b>+{modal.points}</b> pontos</> : <> sem pontuar</>}
                </p>
                <div className="modal-score">
                  <div><span className="user-avatar sm">{st.you.avatar}</span><b>{st.scores[st.youIndex]}</b></div>
                  <span className="vs">×</span>
                  <div><b>{st.scores[st.opp.index]}</b><span className="user-avatar sm">{st.opp.avatar}</span></div>
                </div>
                <div className="countdown">
                  Próxima rodada em <b>{countdown}s</b>
                  <div className="countdown-bar"><span style={{ width: `${(countdown / ROUND_BREAK) * 100}%` }} /></div>
                </div>
              </>
            ) : (
              <>
                <div className="modal-emoji">{modal.winner === st.youIndex ? '🏆' : '💀'}</div>
                <h2>{modal.winner === st.youIndex ? 'Vitória!' : 'Derrota'}</h2>
                <p>
                  {modal.winner === st.youIndex
                    ? `Você venceu a partida contra ${st.opp.name}!`
                    : `${st.opp.name} venceu esta partida.`}
                </p>
                <div className="modal-score">
                  <div><span className="user-avatar sm">{st.you.avatar}</span><b>{st.scores[st.youIndex]}</b></div>
                  <span className="vs">×</span>
                  <div><b>{st.scores[st.opp.index]}</b><span className="user-avatar sm">{st.opp.avatar}</span></div>
                </div>
                <div className="modal-actions">
                  <button
                    className="btn btn-primary"
                    disabled={rematchSent}
                    onClick={() => {
                      sound.click();
                      setRematchSent(true);
                      socketRef.current.emit('game:rematch');
                    }}
                  >
                    {rematchSent ? 'Aguardando oponente…' : '🔄 Revanche'}
                  </button>
                  <button className="btn btn-ghost" onClick={handleLeave}>Voltar ao lobby</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
