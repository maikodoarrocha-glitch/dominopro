// ============================================================
//  Dominó Pro — persistência de usuários (arquivo JSON)
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

let db = { users: [] };
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      db = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (!Array.isArray(db.users)) db.users = [];
    }
  } catch (err) {
    console.error('[store] falha ao ler usuários:', err.message);
    db = { users: [] };
  }
}

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
      console.error('[store] falha ao salvar usuários:', err.message);
    }
  }, 250);
}

load();

export function normalize(username) {
  return String(username || '').trim().toLowerCase();
}

export function findByUsername(username) {
  const n = normalize(username);
  return db.users.find((u) => u.username === n) || null;
}

export function findById(id) {
  return db.users.find((u) => u.id === id) || null;
}

export function createUser({ username, passwordHash, avatar }) {
  const user = {
    id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    username: normalize(username),
    displayName: String(username).trim(),
    passwordHash,
    avatar: avatar || '🦦',
    createdAt: Date.now(),
    stats: { wins: 0, losses: 0, games: 0, points: 0 },
  };
  db.users.push(user);
  persist();
  return user;
}

export function recordResult(userId, won, points) {
  const u = findById(userId);
  if (!u) return;
  u.stats.games += 1;
  u.stats.points += points;
  if (won) u.stats.wins += 1;
  else u.stats.losses += 1;
  persist();
}

export function leaderboard(limit = 10) {
  return db.users
    .slice()
    .sort((a, b) =>
      b.stats.wins - a.stats.wins ||
      b.stats.points - a.stats.points ||
      a.stats.losses - b.stats.losses
    )
    .slice(0, limit)
    .map((u) => ({
      username: u.displayName,
      avatar: u.avatar,
      stats: u.stats,
    }));
}

/** Shape público do usuário (nunca inclui hash). */
export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, stats: u.stats };
}
