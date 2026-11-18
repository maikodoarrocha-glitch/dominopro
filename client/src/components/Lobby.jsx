import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { sound } from '../sound.js';
import Tile from './Tile.jsx';

export default function Lobby({ user, online, muted, onToggleMute, onLogout, toast }) {
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState('Procurando oponente…');
  const [top, setTop] = useState([]);

  const loadTop = () => {
    api('/leaderboard')
      .then((d) => setTop(d.top || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadTop();
  }, []);

  useEffect(() => {
    const s = getSocket();
    const onQueue = (p) => {
      if (p.searching) {
        setSearching(true);
        if (p.message) setSearchMsg(p.message);
      } else {
        setSearching(false);
        if (p.message) toast(p.message, 'warn');
      }
    };
    const onFound = () => sound.found();
    s.on('queue:status', onQueue);
    s.on('game:start', onFound);
    return () => {
      s.off('queue:status', onQueue);
      s.off('game:start', onFound);
    };
  }, [toast]);

  const startOnline = () => {
    sound.click();
    setSearchMsg('Procurando oponente…');
    setSearching(true);
    getSocket().emit('queue:join');
  };

  const cancelSearch = () => {
    sound.click();
    getSocket().emit('queue:leave');
    setSearching(false);
  };

  const startAi = () => {
    sound.click();
    getSocket().emit('game:vsai');
  };

  const stats = user?.stats || { wins: 0, losses: 0, games: 0, points: 0 };
  const winRate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;

  return (
    <div className="lobby">
      <header className="topbar">
        <div className="logo">
          <span className="logo-dot" /> Dominó <em>Pro</em>
        </div>
        <div className="topbar-right">
          <span className="online-pill" title="Jogadores conectados agora">
            <span className="pulse-dot" /> {online} online
          </span>
          <button className="icon-btn" onClick={onToggleMute} title={muted ? 'Ativar som' : 'Silenciar'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <div className="user-chip">
            <span className="user-avatar">{user.avatar}</span>
            <span className="user-name">{user.displayName}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>Sair</button>
        </div>
      </header>

      <main className="lobby-grid">
        <section className="card hero-card">
          <div className="hero-glow" />
          <h1>Bem-vindo(a) à mesa, <span>{user.displayName}</span></h1>
          <p>
            Partidas em tempo real contra jogadores de verdade. Se ninguém estiver livre,
            nossa IA assume o lugar do adversário em segundos.
          </p>

          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={startOnline} disabled={searching}>
              🎯 Jogar online
            </button>
            <button className="btn btn-secondary btn-lg" onClick={startAi} disabled={searching}>
              🤖 Jogar contra a IA
            </button>
          </div>

          <ul className="hero-features">
            <li>Login e progresso salvos</li>
            <li>Placar até 61 pontos</li>
            <li>Bloqueio, compra e W.O. oficiais</li>
          </ul>

          <div className="hero-tiles" aria-hidden>
            <Tile a={6} b={6} dir="v" size="board" />
            <Tile a={4} b={6} size="board" />
            <Tile a={1} b={3} size="board" />
            <Tile a={2} b={2} dir="v" size="board" />
            <Tile a={0} b={5} size="board" />
          </div>
        </section>

        <aside className="side-cards">
          <div className="card stat-card">
            <h3>Seu desempenho</h3>
            <div className="stat-grid">
              <div className="stat"><b>{stats.wins}</b><span>Vitórias</span></div>
              <div className="stat"><b>{stats.games}</b><span>Jogos</span></div>
              <div className="stat"><b>{winRate}%</b><span>Aproveit.</span></div>
              <div className="stat"><b>{stats.points}</b><span>Pontos</span></div>
            </div>
          </div>

          <div className="card">
            <h3>🏆 Ranking</h3>
            {top.length === 0 && <p className="muted">Ninguém no ranking ainda — seja o primeiro!</p>}
            <ol className="ranking">
              {top.map((row, i) => (
                <li key={row.username}>
                  <span className="rank-pos">{i + 1}</span>
                  <span className="rank-avatar">{row.avatar}</span>
                  <span className="rank-name">{row.username}</span>
                  <span className="rank-wins">{row.stats.wins} V</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="card rules-card">
            <h3>Como funciona</h3>
            <p>
              Cada jogador recebe 7 peças. Jogue encaixando números iguais nas pontas —
              se não puder, compre do estoque. Acabou o estoque e nada encaixa? Você passa.
              Quem zerar a mão leva os pontos do adversário; no bloqueio, vence quem tem menos.
            </p>
            <p className="muted">Primeiro a 61 pontos vence a partida.</p>
          </div>
        </aside>
      </main>

      {searching && (
        <div className="overlay">
          <div className="search-box">
            <div className="spinner spinner-lg" />
            <h3>{searchMsg}</h3>
            <p className="muted">Se ninguém responder em alguns segundos, a IA entra no lugar.</p>
            <button className="btn btn-ghost" onClick={cancelSearch}>Cancelar busca</button>
          </div>
        </div>
      )}
    </div>
  );
}
