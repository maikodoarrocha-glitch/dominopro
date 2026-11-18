import React, { useCallback, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from './api.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { gameBus } from './gameBus.js';
import { sound } from './sound.js';
import AuthScreen from './components/AuthScreen.jsx';
import Lobby from './components/Lobby.jsx';
import GameScreen from './components/GameScreen.jsx';

let toastId = 0;

export default function App() {
  const [phase, setPhase] = useState('boot'); // boot | auth | lobby | game
  const [user, setUser] = useState(null);
  const [online, setOnline] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [muted, setMuted] = useState(sound.muted);

  const toast = useCallback((text, kind = 'info') => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // Sessão existente
  useEffect(() => {
    if (!getToken()) {
      setPhase('auth');
      return;
    }
    let alive = true;
    api('/me')
      .then(({ user: u }) => {
        if (!alive) return;
        setUser(u);
        setPhase('lobby');
      })
      .catch(() => {
        if (!alive) return;
        clearToken();
        setPhase('auth');
      });
    return () => { alive = false; };
  }, []);

  // Socket ligado enquanto autenticado
  useEffect(() => {
    if (!user) return;
    const s = connectSocket();

    const onOnline = (p) => setOnline(p.online ?? 0);
    const onStart = () => {
      gameBus.reset();
      setPhase('game');
    };
    const onState = (payload) => gameBus.setState(payload);
    const onGameEvent = (payload) => gameBus.pushEvent(payload);
    const onError = (payload) => toast(payload?.message || 'Erro na partida.', 'error');
    const onConnectError = (err) => {
      if (String(err?.message || '').includes('unauthorized')) {
        handleLogout();
        toast('Sua sessão expirou. Entre novamente.', 'error');
      }
    };

    s.on('players:online', onOnline);
    s.on('game:start', onStart);
    s.on('game:state', onState);
    s.on('game:event', onGameEvent);
    s.on('game:error', onError);
    s.on('connect_error', onConnectError);

    return () => {
      s.off('players:online', onOnline);
      s.off('game:start', onStart);
      s.off('game:state', onState);
      s.off('game:event', onGameEvent);
      s.off('game:error', onError);
      s.off('connect_error', onConnectError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, toast]);

  const handleAuth = (data) => {
    setToken(data.token);
    setUser(data.user);
    setPhase('lobby');
    sound.found();
  };

  const handleLogout = () => {
    disconnectSocket();
    gameBus.reset();
    clearToken();
    setUser(null);
    setPhase('auth');
  };

  const toggleMute = () => {
    const next = sound.toggle();
    setMuted(next);
  };

  const leaveGame = () => {
    getSocket().emit('game:leave');
    gameBus.reset();
    setPhase('lobby');
  };

  return (
    <div className={`app ${muted ? 'is-muted' : ''}`}>
      {phase === 'boot' && (
        <div className="boot">
          <div className="logo logo-lg">
            <span className="logo-dot" /> Dominó <em>Pro</em>
          </div>
          <div className="spinner" />
        </div>
      )}

      {phase === 'auth' && <AuthScreen onAuth={handleAuth} toast={toast} />}

      {phase === 'lobby' && (
        <Lobby
          user={user}
          online={online}
          muted={muted}
          onToggleMute={toggleMute}
          onLogout={handleLogout}
          toast={toast}
        />
      )}

      {phase === 'game' && (
        <GameScreen
          user={user}
          onLeave={leaveGame}
          onToggleMute={toggleMute}
          muted={muted}
          toast={toast}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
