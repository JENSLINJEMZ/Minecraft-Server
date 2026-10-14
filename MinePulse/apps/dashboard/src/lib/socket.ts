import { io, type Socket } from 'socket.io-client';

/**
 * Match the page's hostname (see `lib/api.ts`) so the session cookie is
 * first-party and the socket handshake is authenticated.
 */
function resolveSocketUrl(): string {
  const fromEnv = import.meta.env.VITE_SOCKET_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://127.0.0.1:4000';
  const host = window.location.hostname || '127.0.0.1';
  return `${window.location.protocol}//${host}:4000`;
}

const SOCKET_URL = resolveSocketUrl();

/** Create a Socket.IO client bound to the API, sending the session cookie. */
export function createSocket(): Socket {
  return io(SOCKET_URL, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
}
