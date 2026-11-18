import { io } from 'socket.io-client';
import { getToken } from './api.js';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io('/', {
      auth: { token: getToken() },
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
