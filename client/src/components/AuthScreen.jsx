import React, { useState } from 'react';
import { api } from '../api.js';
import Tile from './Tile.jsx';

const AVATARS = ['🦦', '🦊', '🐼', '🦉', '🐸', '🦁', '🐯', '🐵', '🦄', '🐙', '🐺', '🐨', '🦅', '🐲'];

export default function AuthScreen({ onAuth, toast }) {
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api(mode === 'login' ? '/login' : '/register', {
        method: 'POST',
        body: { username, password, avatar },
      });
      onAuth(data);
      toast(`Bem-vindo(a), ${data.user.displayName}!`, 'good');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    setError('');
    setBusy(true);
    try {
      const name = `Convidado_${Math.floor(1000 + Math.random() * 9000)}`;
      const pass = `guest_${Math.random().toString(36).slice(2, 10)}`;
      const av = AVATARS[Math.floor(Math.random() * AVATARS.length)];
      const data = await api('/register', {
        method: 'POST',
        body: { username: name, password: pass, avatar: av },
      });
      onAuth(data);
      toast('Você entrou como convidado.', 'good');
    } catch (err) {
      // nome colidindo: tenta de novo
      if (String(err.message).includes('uso')) return guest();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-bg" />
      <div className="auth-card">
        <div className="logo logo-lg">
          <span className="logo-dot" /> Dominó <em>Pro</em>
        </div>
        <p className="tagline">Jogue dominó com pessoas reais — ou com a IA quando ninguém estiver online.</p>

        <div className="auth-preview" aria-hidden>
          <Tile a={6} b={6} dir="v" size="mini" />
          <Tile a={5} b={3} size="mini" />
          <Tile a={2} b={2} dir="v" size="mini" />
          <Tile a={4} b={6} size="mini" />
          <Tile back size="mini" />
        </div>

        <div className="tabs">
          <button
            className={`tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
            type="button"
          >
            Entrar
          </button>
          <button
            className={`tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
            type="button"
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <div className="field">
              <label>Seu avatar</label>
              <div className="avatar-grid">
                {AVATARS.map((av) => (
                  <button
                    key={av}
                    type="button"
                    className={`avatar-opt ${av === avatar ? 'selected' : ''}`}
                    onClick={() => setAvatar(av)}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>Nome de usuário</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex.: mestre_do_domino"
              autoComplete="username"
              maxLength={20}
              required
            />
          </div>

          <div className="field">
            <label>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 6 caracteres"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button className="btn btn-primary btn-block" disabled={busy} type="submit">
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar na plataforma' : 'Criar conta e jogar'}
          </button>
        </form>

        <div className="auth-divider"><span>ou</span></div>
        <button className="btn btn-ghost btn-block" onClick={guest} disabled={busy} type="button">
          Jogar como convidado
        </button>
      </div>
    </div>
  );
}
