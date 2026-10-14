import { prisma } from '../lib/prisma.js';
import { playerRepository } from '../repositories/playerRepository.js';
import { heartbeatRepository } from '../repositories/heartbeatRepository.js';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { eventRepository } from '../repositories/eventRepository.js';
import {
  toPlayerSession,
  toPlayerSummary,
  type BanInfo,
  type LivePlayerAttributes,
} from './dto.js';
import { moderationService } from './moderationService.js';
import { AppError } from '../utils/errors.js';
import type {
  PlayerDailyActivity,
  PlayerDeaths,
  PlayerDetail,
  PlayerSession,
  PlayerSummary,
  PlayersAnalytics,
} from '@minepulse/shared';

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
 * Live online-player attributes (world/ping/gamemode/op/stats) stored on the
 * server row by the last heartbeat. Malformed JSON degrades to an empty map.
 */
async function liveRoster(serverId: string): Promise<{
  live: Map<string, LivePlayerAttributes>;
  bans: Map<string, BanInfo>;
}> {
  const live = new Map<string, LivePlayerAttributes>();
  const bans = new Map<string, BanInfo>();
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { livePlayersJson: true, liveBansJson: true },
  });
  if (server?.livePlayersJson) {
    try {
      const rows = JSON.parse(server.livePlayersJson) as Array<{ uuid?: string } & LivePlayerAttributes>;
      for (const row of rows) {
        if (row && typeof row.uuid === 'string') live.set(row.uuid, row);
      }
    } catch {
      // Ignore malformed payloads; the roster simply reads as unavailable.
    }
  }
  if (server?.liveBansJson) {
    try {
      const rows = JSON.parse(server.liveBansJson) as Array<{
        target?: string;
        reason?: string | null;
        source?: string | null;
        expiresAt?: string | null;
      }>;
      for (const row of rows) {
        if (!row || typeof row.target !== 'string') continue;
        bans.set(row.target.toLowerCase(), {
          reason: row.reason ?? null,
          source: row.source ?? null,
          expiresAt: row.expiresAt ?? null,
        });
      }
    } catch {
      // Bans are best-effort; a bad blob just means no ban badges.
    }
  }
  return { live, bans };
}

/** Find the ban entry for a player, matching the UUID or the known username. */
function banFor(
  player: { uuid: string; lastKnownUsername: string },
  bans: Map<string, BanInfo>,
): BanInfo | null {
  return bans.get(player.uuid.toLowerCase()) ?? bans.get(player.lastKnownUsername.toLowerCase()) ?? null;
}

/** Merge map of uuids -> stats without re-querying per player. */
async function summarise(
  players: Array<{ uuid: string; lastKnownUsername: string; firstSeenAt: Date | null; lastSeenAt: Date | null }>,
  open: Map<string, Date>,
  live: Map<string, LivePlayerAttributes>,
  bans: Map<string, BanInfo>,
  muted: Set<string>,
): Promise<PlayerSummary[]> {
  return Promise.all(
    players.map(async (p) => {
      const stats = await playerRepository.aggregateStats(p.uuid);
      const online = open.has(p.uuid);
      return toPlayerSummary(p, online, open.get(p.uuid) ?? null, stats, online ? live.get(p.uuid) : null, {
        muted: muted.has(p.uuid),
        ban: banFor(p, bans),
      });
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
    const [{ live, bans }, muted, map] = await Promise.all([
      liveRoster(serverId),
      moderationRepository.mutedSet(serverId),
      openMap ? Promise.resolve(openMap) : openSessionMap(serverId),
    ]);
    const stats = await playerRepository.aggregateStats(playerUuid);
    const online = map.has(playerUuid);
    return toPlayerSummary(player, online, map.get(playerUuid) ?? null, stats, online ? live.get(playerUuid) : null, {
      muted: muted.has(playerUuid),
      ban: banFor(player, bans),
    });
  },

  async buildOnlineSummaries(serverId: string): Promise<PlayerSummary[]> {
    const [{ live, bans }, muted, map] = await Promise.all([
      liveRoster(serverId),
      moderationRepository.mutedSet(serverId),
      openSessionMap(serverId),
    ]);
    const uuids = Array.from(map.keys());
    if (uuids.length === 0) return [];
    const players = await prisma.player.findMany({ where: { uuid: { in: uuids } } });
    const summaries = await summarise(players, map, live, bans, muted);
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
    const [{ live, bans }, muted, map] = await Promise.all([
      liveRoster(serverId),
      moderationRepository.mutedSet(serverId),
      openSessionMap(serverId),
    ]);

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

    const summaries = await summarise(items, map, live, bans, muted);
    return { items: summaries, total };
  },

  async get(serverId: string, uuid: string): Promise<PlayerDetail> {
    const summary = await this.buildSummary(uuid, serverId);
    if (!summary) throw AppError.notFound('Player not found');
    const notes = await moderationService.notes(serverId, uuid);
    return { ...summary, notes };
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

  /** Deaths-by-cause tally for one player, built from recorded death events. */
  async deathsByCause(serverId: string, uuid: string, days: number): Promise<PlayerDeaths> {
    const window = Math.min(365, Math.max(1, days));
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
    const causes = await eventRepository.deathsByCause(serverId, uuid, since);
    const total = causes.reduce((sum, cause) => sum + cause.count, 0);
    return { uuid, total, causes };
  },

  /** Daily playtime (seconds) for one player over the trailing `days` days. */
  async dailyActivity(uuid: string, days: number): Promise<PlayerDailyActivity[]> {
    const window = Math.min(180, Math.max(1, days));
    const now = Date.now();
    const since = new Date(now - (window - 1) * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const sessions = await prisma.playerSession.findMany({
      where: { playerUuid: uuid, joinedAt: { gte: since } },
      select: { joinedAt: true, leftAt: true, durationSeconds: true },
    });

    const byDay = new Map<string, number>();
    for (const s of sessions) {
      const day = s.joinedAt.toISOString().slice(0, 10);
      const seconds =
        s.durationSeconds ??
        Math.max(0, Math.round(((s.leftAt ?? new Date()).getTime() - s.joinedAt.getTime()) / 1000));
      byDay.set(day, (byDay.get(day) ?? 0) + seconds);
    }

    const out: PlayerDailyActivity[] = [];
    for (let i = window - 1; i >= 0; i -= 1) {
      const day = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      out.push({ day, seconds: byDay.get(day) ?? 0 });
    }
    return out;
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
