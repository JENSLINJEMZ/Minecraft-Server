import type { Server as DbServer } from '@prisma/client';
import type {
  EventsPayload,
  HeartbeatPayload,
  MetricsPayload,
  PluginsPayload,
  ServerEventInput,
} from '@minepulse/shared';
import { heartbeatRepository } from '../repositories/heartbeatRepository.js';
import { metricRepository } from '../repositories/metricRepository.js';
import { playerRepository } from '../repositories/playerRepository.js';
import { pluginRepository } from '../repositories/pluginRepository.js';
import { eventRepository } from '../repositories/eventRepository.js';
import { serverRepository } from '../repositories/serverRepository.js';
import { bus } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';
import { toCurrentMetrics, toServerEvent, toPluginSnapshot } from './dto.js';
import { resolveStatus } from './statusService.js';
import { playersService } from './playersService.js';

/** Emit a synthetic event (agent connect/disconnect, plugin change, ...). */
async function emitSyntheticEvent(
  server: DbServer,
  event: ServerEventInput,
  requestId: string | null,
): Promise<void> {
  const { rows } = await eventRepository.createMany(
    server.id,
    [event],
    requestId ?? `synthetic-${Date.now()}-${event.type}`,
  );
  for (const row of rows) bus.publish('event', toServerEvent(row));
}

/**
 * Ingest a heartbeat: persist it, refresh server identity, reconcile the online
 * player roster with open sessions, then publish status + players + transitions.
 */
export async function ingestHeartbeat(
  server: DbServer,
  payload: HeartbeatPayload,
): Promise<{ duplicate: boolean }> {
  const receivedAt = new Date();
  const previousStatus = await resolveStatus(server);

  const stored = await heartbeatRepository.create({
    serverId: server.id,
    sequence: payload.sequence,
    requestId: payload.requestId,
    agentVersion: payload.agentVersion,
    minecraftVersion: payload.minecraftVersion,
    paperVersion: payload.paperVersion,
    serverUptimeSeconds: Math.round(payload.serverUptimeSeconds),
    playerCount: payload.playerCount,
    maxPlayers: payload.maxPlayers,
    status: 'online',
  });

  // Keep server identity current, including the connect address the agent reports.
  const livePlayersJson = JSON.stringify(
    payload.players.map((p) => ({
      uuid: p.uuid,
      world: p.world ?? null,
      pingMs: p.pingMs ?? null,
      gamemode: p.gamemode ?? null,
      operator: p.operator ?? false,
      position: p.position ?? null,
      health: p.health ?? null,
      foodLevel: p.foodLevel ?? null,
      xpLevel: p.xpLevel ?? null,
      mobKills: p.mobKills ?? null,
      deaths: p.deaths ?? null,
      blocksMined: p.blocksMined ?? null,
      clientBrand: p.clientBrand ?? null,
    })),
  );
  const liveBansJson = JSON.stringify(payload.bans ?? []);
  await serverRepository
    .update(server.id, {
      minecraftVersion: payload.minecraftVersion,
      software: `Paper ${payload.paperVersion}`,
      ...(payload.serverAddress ? { address: payload.serverAddress } : {}),
      ...(payload.system ? { systemJson: JSON.stringify(payload.system) } : {}),
      livePlayersJson,
      liveBansJson,
    })
    .catch(() => null);
  server.livePlayersJson = livePlayersJson;
  server.liveBansJson = liveBansJson;
  if (payload.serverAddress) {
    server.address = payload.serverAddress;
  }
  if (payload.system) {
    server.systemJson = JSON.stringify(payload.system);
  }

  // Reconcile the online roster and open/close sessions.
  const at = new Date(payload.timestamp);
  const onlineUuids: string[] = [];
  for (const p of payload.players) {
    onlineUuids.push(p.uuid);
    await playerRepository.upsertSeen(p.uuid, p.username, at);
    const open = await playerRepository.findOpenSession(server.id, p.uuid);
    if (!open) {
      await playerRepository.openSession({
        serverId: server.id,
        playerUuid: p.uuid,
        usernameAtJoin: p.username,
        joinedAt: at,
      });
    }
  }
  await playerRepository.closeSessionsNotIn(server.id, onlineUuids, receivedAt, 'left');

  // Detect agent (re)connection transitions.
  if (!previousStatus.heartbeat) {
    await emitSyntheticEvent(
      server,
      {
        type: 'agent_connected',
        severity: 'info',
        occurredAt: receivedAt.toISOString(),
        summary: `Agent connected (Paper ${payload.paperVersion})`,
        details: { agentVersion: payload.agentVersion },
      },
      payload.requestId,
    );
  } else if (previousStatus.state === 'offline' || previousStatus.state === 'stale') {
    await emitSyntheticEvent(
      server,
      {
        type: 'heartbeat_restored',
        severity: 'info',
        occurredAt: receivedAt.toISOString(),
        summary: 'Heartbeat restored',
        details: { previousState: previousStatus.state },
      },
      payload.requestId,
    );
  }

  // Publish fresh status + players.
  const status = await resolveStatus(server);
  bus.publish('status', status.dto);
  const online = await playersService.buildOnlineSummaries(server.id);
  bus.publish('players', {
    serverId: server.id,
    online,
    onlineCount: payload.playerCount,
  });

  return { duplicate: stored === null };
}

/** Ingest a metrics sample. */
export async function ingestMetrics(server: DbServer, payload: MetricsPayload): Promise<void> {
  const stored = await metricRepository.create({
    serverId: server.id,
    sequence: payload.sequence,
    requestId: payload.requestId,
    recordedAt: new Date(payload.timestamp),
    tps1m: payload.tps1m ?? null,
    tps5m: payload.tps5m ?? null,
    tps15m: payload.tps15m ?? null,
    mspt: payload.mspt ?? null,
    heapUsedBytes: payload.heapUsedBytes,
    heapMaxBytes: payload.heapMaxBytes,
    heapCommittedBytes: payload.heapCommittedBytes,
    cpuUsagePercent: payload.cpuUsagePercent ?? null,
    gc: payload.gc ?? null,
    nonHeapUsedBytes: payload.nonHeapUsedBytes ?? null,
    metaspaceUsedBytes: payload.metaspaceUsedBytes ?? null,
    heapOldBytes: payload.heapOldBytes ?? null,
    heapYoungBytes: payload.heapYoungBytes ?? null,
    directBufferBytes: payload.directBufferBytes ?? null,
    threadCount: payload.threadCount ?? null,
    daemonThreadCount: payload.daemonThreadCount ?? null,
    entityCount: payload.entityCount ?? null,
    chunkCount: payload.chunkCount ?? null,
    tickBreakdown: payload.tickBreakdown ?? null,
    pluginTickCost: payload.pluginTickCost ?? null,
    netRxBytes: payload.netRxBytes ?? null,
    netTxBytes: payload.netTxBytes ?? null,
  });

  if (stored) {
    const status = await resolveStatus(server);
    bus.publish('status', status.dto);
    bus.publish('metrics', toCurrentMetrics(server, status.heartbeat, stored));
  }
}

/** Ingest a batch of structured events and broadcast each one. */
export async function ingestEvents(server: DbServer, payload: EventsPayload): Promise<number> {
  const { rows } = await eventRepository.createMany(server.id, payload.events, payload.requestId);
  for (const row of rows) bus.publish('event', toServerEvent(row));
  return rows.length;
}

/** Ingest a plugin inventory snapshot; emit a change event when the hash differs. */
export async function ingestPlugins(server: DbServer, payload: PluginsPayload): Promise<void> {
  const latest = await pluginRepository.latestSnapshot(server.id);

  // Steady state: the agent keeps reporting the same inventory. Nothing to
  // store and nothing to broadcast, so skip the write entirely.
  if (latest && latest.inventoryHash === payload.inventoryHash) {
    logger.debug({ serverId: server.id }, 'Plugin snapshot unchanged (deduped)');
    return;
  }

  const stored = await pluginRepository.createSnapshot({
    serverId: server.id,
    collectedAt: new Date(payload.collectedAt),
    inventoryHash: payload.inventoryHash,
    plugins: payload.plugins.map((p) => ({
      name: p.name,
      version: p.version,
      enabled: p.enabled,
      apiVersion: p.apiVersion ?? null,
      author: p.author ?? null,
      commandCount: p.commandCount ?? null,
    })),
  });

  if (!stored) {
    logger.debug({ serverId: server.id }, 'Plugin snapshot unchanged (deduped)');
    return;
  }

  if (latest && latest.inventoryHash !== stored.inventoryHash) {
    await emitSyntheticEvent(
      server,
      {
        type: 'plugins_changed',
        severity: 'info',
        occurredAt: stored.collectedAt.toISOString(),
        summary: `Plugin inventory changed (${latest.pluginCount} -> ${stored.pluginCount})`,
        details: {
          previousHash: latest.inventoryHash,
          newHash: stored.inventoryHash,
        },
      },
      payload.requestId,
    );
  }

  const snap = await pluginRepository.latestSnapshot(server.id);
  if (snap) bus.publish('plugins', toPluginSnapshot(snap));
}
