import { prisma } from '../lib/prisma.js';
import { playerRepository } from '../repositories/playerRepository.js';
import { heartbeatRepository } from '../repositories/heartbeatRepository.js';
import { toPlayerSession, toPlayerSummary, type LivePlayerAttributes } from './dto.js';
import { AppError } from '../utils/errors.js';
import type { PlayerSession, PlayerSummary, PlayersAnalytics } from '@minepulse/shared';

/** Map of playerUuid -> session startedAt for currently-open sessions. */
async function openSessionMap(serverId: string): Promise<Map<string, Date>> {
  const open = await prisma.playerSession.findMany({
    where: { serverId, leftAt: null },
    select: { playerUuid: true, joinedAt: true },
  });
  const map = new Map<string, Date>();
  for (const s of open) {
    const existing = map.get(s.playerUuid);
    if (!existing || s.joinedAt < existing) map.set(s.playerUuid, s.joinedAt);
  }
  return map;
}

/**
 * Live online-player attributes (world/ping/gamemode/op) stored on the server
 * row by the last heartbeat. Malformed JSON degrades to an empty map.
 */
async function liveRosterMap(serverId: string): Promise<Map<string, LivePlayerAttributes>> {
  const map = new Map<string, LivePlayerAttributes>();
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { livePlayersJson: true },
  });
  if (!server?.livePlayersJson) return map;
  try {
    const rows = JSON.parse(server.livePlayersJson) as Array<{ uuid?: string } & LivePlayerAttributes>;
    for (const row of rows) {
      if (row && typeof row.uuid === 'string') map.set(row.uuid, row);
    }
  } catch {
    // Ignore malformed payloads; the roster simply reads as unavailable.
  }
  return map;
}

/** Merge map of uuids -> stats without re-querying per player. */
async function summarise(
  players: Array<{ uuid: string; lastKnownUsername: string; firstSeenAt: Date | null; lastSeenAt: Date | null }>,
  open: Map<string, Date>,
  live: Map<string, LivePlayerAttributes>,
): Promise<PlayerSummary[]> {
  return Promise.all(
    players.map(async (p) => {
      const stats = await playerRepository.aggregateStats(p.uuid);
      const online = open.has(p.uuid);
      return toPlayerSummary(p, online, open.get(p.uuid) ?? null, stats, online ? live.get(p.uuid) : null);
    }),
  );
}

export const playersService = {
  async buildSummary(
    playerUuid: string,
    serverId: string,
    openMap?: Map<string, Date>,
  ): Promise<PlayerSummary | null> {
    const player = await playerRepository.findById(playerUuid);
    if (!player) return null;
    const [map, live] = await Promise.all([
      openMap ? Promise.resolve(openMap) : openSessionMap(serverId),
      liveRosterMap(serverId),
    ]);
    const stats = await playerRepository.aggregateStats(playerUuid);
    const online = map.has(playerUuid);
    return toPlayerSummary(player, online, map.get(playerUuid) ?? null, stats, online ? live.get(playerUuid) : null);
  },

  async buildOnlineSummaries(serverId: string): Promise<PlayerSummary[]> {
    const [map, live] = await Promise.all([openSessionMap(serverId), liveRosterMap(serverId)]);
    const uuids = Array.from(map.keys());
    if (uuids.length === 0) return [];
    const players = await prisma.player.findMany({ where: { uuid: { in: uuids } } });
    const summaries = await summarise(players, map, live);
    return summaries.sort((a, b) => a.lastKnownUsername.localeCompare(b.lastKnownUsername));
  },

  async list(
    serverId: string,
    params: {
      search?: string;
      from?: Date;
      to?: Date;
      onlineOnly?: boolean;
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: PlayerSummary[]; total: number }> {
    const [map, live] = await Promise.all([openSessionMap(serverId), liveRosterMap(serverId)]);

    if (params.onlineOnly) {
      const summaries = await this.buildOnlineSummaries(serverId);
      const filtered = params.search
        ? summaries.filter((s) =>
            s.lastKnownUsername.toLowerCase().includes(params.search!.toLowerCase()),
          )
        : summaries;
      const start = (params.page - 1) * params.pageSize;
      return { items: filtered.slice(start, start + params.pageSize), total: filtered.length };
    }

    const { items, total } = await playerRepository.list({
      search: params.search,
      from: params.from,
      to: params.to,
      page: params.page,
      pageSize: params.pageSize,
    });

    const summaries = await summarise(items, map, live);
    return { items: summaries, total };
  },

  async get(serverId: string, uuid: string): Promise<PlayerSummary> {
    const summary = await this.buildSummary(uuid, serverId);
    if (!summary) throw AppError.notFound('Player not found');
    return summary;
  },

  async sessions(
    uuid: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: PlayerSession[]; total: number }> {
    const { items, total } = await playerRepository.sessions(uuid, page, pageSize);
    return { items: items.map(toPlayerSession), total };
  },

  activity(serverId: string, days: number) {
    return playerRepository.activity(serverId, days);
  },

  async analytics(serverId: string, hours: number): Promise<PlayersAnalytics> {
    const [agg, open, heartbeat] = await Promise.all([
      playerRepository.analytics(serverId, hours),
      openSessionMap(serverId),
      heartbeatRepository.latest(serverId),
    ]);
    return {
      serverId,
      windowHours: hours,
      onlineNow: open.size,
      maxPlayers: heartbeat?.maxPlayers ?? null,
      uniquePlayers: agg.uniquePlayers,
      newPlayers: agg.newPlayers,
      sessions: agg.sessions,
      avgSessionSeconds: agg.avgSessionSeconds,
      sessionBuckets: agg.sessionBuckets,
      retention: agg.retention,
    };
  },
};
