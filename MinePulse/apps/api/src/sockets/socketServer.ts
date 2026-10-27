import type { Server as IOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '@minepulse/shared';
import { prisma } from '../lib/prisma.js';
import { SESSION_COOKIE, unsignValue } from '../security/session.js';
import { bus } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';
import { getPrimaryServer } from '../services/serverContext.js';
import { resolveStatus } from '../services/statusService.js';
import { heartbeatRepository } from '../repositories/heartbeatRepository.js';
import { metricRepository } from '../repositories/metricRepository.js';
import { toCurrentMetrics } from '../services/dto.js';
import { playersService } from '../services/playersService.js';
import { pluginsService } from '../services/pluginsService.js';

const room = (serverId: string): string => `server:${serverId}`;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/** Authenticate a socket handshake using the same signed session cookie. */
async function authenticate(socket: Socket): Promise<boolean> {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return false;
  const id = unsignValue(raw);
  if (!id) return false;
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.expiresAt.getTime() < Date.now()) return false;
  socket.data.userId = session.user.id;
  return true;
}

export function setupSocket(io: IOServer): void {
  io.use(async (socket, next) => {
    try {
      const ok = await authenticate(socket);
      if (!ok) return next(new Error('unauthorized'));
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    try {
      const server = await getPrimaryServer();
      await socket.join(room(server.id));

      // Send an initial snapshot so a freshly connected client is immediately current.
      const [status, heartbeat, sample] = await Promise.all([
        resolveStatus(server),
        heartbeatRepository.latest(server.id),
        metricRepository.latest(server.id),
      ]);
      const [online, plugins] = await Promise.all([
        playersService.buildOnlineSummaries(server.id),
        pluginsService.latest(server.id),
      ]);

      socket.emit(SOCKET_EVENTS.serverStatus, status.dto);
      socket.emit(SOCKET_EVENTS.serverMetrics, toCurrentMetrics(server, heartbeat, sample));
      socket.emit(SOCKET_EVENTS.serverPlayers, {
        serverId: server.id,
        online,
        onlineCount: heartbeat?.playerCount ?? online.length,
      });
      if (plugins) socket.emit(SOCKET_EVENTS.serverPlugins, plugins);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to send initial socket snapshot');
    }

    socket.on('disconnect', (reason) => {
      logger.debug({ reason }, 'Socket disconnected');
    });
  });

  // Fan out persisted telemetry to connected clients (persist-before-broadcast).
  bus.subscribe('status', (status) => {
    io.to(room(status.serverId)).emit(SOCKET_EVENTS.serverStatus, status);
  });
  bus.subscribe('metrics', (metrics) => {
    io.to(room(metrics.serverId)).emit(SOCKET_EVENTS.serverMetrics, metrics);
  });
  bus.subscribe('players', (payload) => {
    io.to(room(payload.serverId)).emit(SOCKET_EVENTS.serverPlayers, payload);
  });
  bus.subscribe('plugins', (snapshot) => {
    io.to(room(snapshot.serverId)).emit(SOCKET_EVENTS.serverPlugins, snapshot);
  });
  bus.subscribe('event', (event) => {
    io.to(room(event.serverId)).emit(SOCKET_EVENTS.serverEvent, event);
  });
  bus.subscribe('chat', (payload) => {
    io.to(room(payload.serverId)).emit(SOCKET_EVENTS.serverChat, payload.message);
  });
  bus.subscribe('action', (payload) => {
    io.to(room(payload.serverId)).emit(SOCKET_EVENTS.serverAction, payload.action);
  });
  bus.subscribe('alert:triggered', (payload) => {
    io.to(room(payload.rule.serverId)).emit(SOCKET_EVENTS.alertTriggered, payload);
  });
  bus.subscribe('alert:resolved', (payload) => {
    io.to(room(payload.rule.serverId)).emit(SOCKET_EVENTS.alertResolved, payload);
  });
}
