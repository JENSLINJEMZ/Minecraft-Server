import { prisma } from '../lib/prisma.js';
import { playerRepository } from '../repositories/playerRepository.js';
import { toPlayerSession, toPlayerSummary } from './dto.js';
import { AppError } from '../utils/errors.js';
import type { PlayerSession, PlayerSummary } from '@minepulse/shared';

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

export const playersService = {
  async buildSummary(
    playerUuid: string,
    serverId: string,
    openMap?: Map<string, Date>,
  ): Promise<PlayerSummary | null> {
    const player = await playerRepository.findById(playerUuid);
    if (!player) return null;
    const map = openMap ?? (await openSessionMap(serverId));
    const stats = await playerRepository.aggregateStats(playerUuid);
    return toPlayerSummary(player, map.has(playerUuid), map.get(playerUuid) ?? null, stats);
  },

  async buildOnlineSummaries(serverId: string): Promise<PlayerSummary[]> {
    const map = await openSessionMap(serverId);
    const uuids = Array.from(map.keys());
    if (uuids.length === 0) return [];
    const players = await prisma.player.findMany({ where: { uuid: { in: uuids } } });
    const summaries = await Promise.all(
      players.map(async (p) => {
        const stats = await playerRepository.aggregateStats(p.uuid);
        return toPlayerSummary(p, true, map.get(p.uuid) ?? null, stats);
      }),
    );
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
    const map = await openSessionMap(serverId);

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

    const summaries = await Promise.all(
      items.map(async (p) => {
        const stats = await playerRepository.aggregateStats(p.uuid);
        return toPlayerSummary(p, map.has(p.uuid), map.get(p.uuid) ?? null, stats);
      }),
    );
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
};
