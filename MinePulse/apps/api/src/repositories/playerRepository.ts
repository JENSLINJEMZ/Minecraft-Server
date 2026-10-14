import { prisma } from '../lib/prisma.js';
import type { Player, PlayerSession } from '@prisma/client';

export const playerRepository = {
  /** Upsert the global player record on join/heartbeat. */
  upsertSeen(uuid: string, username: string, at: Date): Promise<Player> {
    return prisma.player.upsert({
      where: { uuid },
      create: { uuid, lastKnownUsername: username, firstSeenAt: at, lastSeenAt: at },
      update: { lastKnownUsername: username, lastSeenAt: at },
    });
  },

  touchLastSeen(uuid: string, at: Date) {
    return prisma.player.update({ where: { uuid }, data: { lastSeenAt: at } }).catch(() => null);
  },

  openSession(input: {
    serverId: string;
    playerUuid: string;
    usernameAtJoin: string;
    joinedAt: Date;
  }): Promise<PlayerSession> {
    return prisma.playerSession.create({ data: { ...input, closedReason: null } });
  },

  /** Find an already-open session for a player on a server (idempotency). */
  findOpenSession(serverId: string, playerUuid: string): Promise<PlayerSession | null> {
    return prisma.playerSession.findFirst({
      where: { serverId, playerUuid, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });
  },

  closeSession(id: string, leftAt: Date, reason: string) {
    return prisma.playerSession
      .update({
        where: { id },
        data: {
          leftAt,
          durationSeconds: Math.max(0, Math.round((leftAt.getTime() - 0) / 1000)),
          closedReason: reason,
        },
      })
      .catch(() => null);
  },

  /** Close a session with an explicit joinedAt for duration accuracy. */
  async closeSessionWithJoin(id: string, joinedAt: Date, leftAt: Date, reason: string) {
    const durationSeconds = Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 1000));
    return prisma.playerSession
      .update({ where: { id }, data: { leftAt, durationSeconds, closedReason: reason } })
      .catch(() => null);
  },

  /** Close every still-open session for a server (e.g. on shutdown/disconnect). */
  async closeAllOpen(serverId: string, leftAt: Date, reason: string) {
    const open = await prisma.playerSession.findMany({
      where: { serverId, leftAt: null },
      select: { id: true, joinedAt: true },
    });
    for (const s of open) {
      const durationSeconds = Math.max(0, Math.round((leftAt.getTime() - s.joinedAt.getTime()) / 1000));
      await prisma.playerSession
        .update({ where: { id: s.id }, data: { leftAt, durationSeconds, closedReason: reason } })
        .catch(() => null);
    }
    return open.length;
  },

  /** Ensure players that are no longer in the online roster have closed sessions. */
  async closeSessionsNotIn(serverId: string, onlineUuids: string[], leftAt: Date, reason: string) {
    const open = await prisma.playerSession.findMany({
      where: { serverId, leftAt: null },
    });
    const online = new Set(onlineUuids);
    let closed = 0;
    for (const s of open) {
      if (online.has(s.playerUuid)) continue;
      const durationSeconds = Math.max(0, Math.round((leftAt.getTime() - s.joinedAt.getTime()) / 1000));
      await prisma.playerSession
        .update({ where: { id: s.id }, data: { leftAt, durationSeconds, closedReason: reason } })
        .catch(() => null);
      closed++;
    }
    return closed;
  },

  async list(params: {
    search?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ items: Player[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (params.search) {
      where.lastKnownUsername = { contains: params.search };
    }
    const dateFilter: Record<string, Date> = {};
    if (params.from) dateFilter.gte = params.from;
    if (params.to) dateFilter.lte = params.to;
    if (Object.keys(dateFilter).length > 0) where.lastSeenAt = dateFilter;

    const [items, total] = await Promise.all([
      prisma.player.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.player.count({ where }),
    ]);
    return { items, total };
  },

  findById(uuid: string): Promise<Player | null> {
    return prisma.player.findUnique({ where: { uuid } });
  },

  async sessions(uuid: string, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      prisma.playerSession.findMany({
        where: { playerUuid: uuid },
        orderBy: { joinedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.playerSession.count({ where: { playerUuid: uuid } }),
    ]);
    return { items, total };
  },

  async aggregateStats(uuid: string) {
    const agg = await prisma.playerSession.aggregate({
      where: { playerUuid: uuid },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    });
    return {
      totalPlaytimeSeconds: agg._sum.durationSeconds ?? 0,
      sessionCount: agg._count._all,
    };
  },

  async activity(serverId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sessions = await prisma.playerSession.findMany({
      where: { serverId, joinedAt: { gte: since } },
      select: { playerUuid: true, joinedAt: true, leftAt: true, durationSeconds: true },
    });
    const byDay = new Map<string, { players: Set<string>; sessions: number }>();
    for (const s of sessions) {
      const day = s.joinedAt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? { players: new Set<string>(), sessions: 0 };
      bucket.players.add(s.playerUuid);
      bucket.sessions += 1;
      byDay.set(day, bucket);
    }
    return Array.from(byDay.entries())
      .map(([day, v]) => ({
        day,
        uniquePlayers: v.players.size,
        sessions: v.sessions,
        peakConcurrent: 0,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));
  },

  /**
   * Session + retention aggregates for a trailing window. All values are
   * measured from stored sessions/player records; nothing is estimated.
   */
  async analytics(serverId: string, hours: number) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [sessions, newPlayers, uniquePlayers, allPlayers] = await Promise.all([
      prisma.playerSession.findMany({
        where: { serverId, joinedAt: { gte: since } },
        select: { durationSeconds: true },
      }),
      prisma.player.count({ where: { firstSeenAt: { gte: since } } }),
      prisma.player.count({ where: { lastSeenAt: { gte: since } } }),
      prisma.player.findMany({ select: { firstSeenAt: true, lastSeenAt: true } }),
    ]);

    let closed = 0;
    let totalDuration = 0;
    const buckets: [number, number, number, number] = [0, 0, 0, 0]; // <10m, 10-30m, 30-60m, >60m
    for (const s of sessions) {
      if (s.durationSeconds == null) continue;
      closed += 1;
      totalDuration += s.durationSeconds;
      const minutes = s.durationSeconds / 60;
      if (minutes < 10) buckets[0] += 1;
      else if (minutes < 30) buckets[1] += 1;
      else if (minutes < 60) buckets[2] += 1;
      else buckets[3] += 1;
    }

    const now = Date.now();
    const retention = [
      { label: 'Day 1', days: 1 },
      { label: 'Day 7', days: 7 },
      { label: 'Day 30', days: 30 },
    ].map(({ label, days }) => {
      const cutoff = days * 24 * 60 * 60 * 1000;
      let cohort = 0;
      let returned = 0;
      for (const p of allPlayers) {
        if (!p.firstSeenAt || now - p.firstSeenAt.getTime() < cutoff) continue;
        cohort += 1;
        if (p.lastSeenAt && p.lastSeenAt.getTime() - p.firstSeenAt.getTime() >= cutoff) returned += 1;
      }
      return { label, cohort, pct: cohort ? (returned / cohort) * 100 : null };
    });

    return {
      uniquePlayers,
      newPlayers,
      sessions: sessions.length,
      avgSessionSeconds: closed ? totalDuration / closed : null,
      sessionBuckets: [
        { label: 'Under 10 min', count: buckets[0] ?? 0 },
        { label: '10 to 30 min', count: buckets[1] ?? 0 },
        { label: '30 to 60 min', count: buckets[2] ?? 0 },
        { label: 'Over 1 hour', count: buckets[3] ?? 0 },
      ],
      retention,
    };
  },
};
