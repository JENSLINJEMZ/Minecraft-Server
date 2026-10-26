import { prisma } from '../lib/prisma.js';
import type { ServerSettings } from '@prisma/client';
import { env } from '../config/env.js';

export interface SettingsData {
  retentionRawMetricsDays: number;
  retentionAggregated1mDays: number;
  retentionAggregated1hDays: number;
  retentionEventsDays: number;
  retentionPlayerSessionsDays: number;
  heartbeatStaleSeconds: number;
  heartbeatOfflineSeconds: number;
}

export const DEFAULT_SETTINGS: SettingsData = {
  retentionRawMetricsDays: 7,
  retentionAggregated1mDays: 30,
  retentionAggregated1hDays: 180,
  retentionEventsDays: 30,
  retentionPlayerSessionsDays: 90,
  heartbeatStaleSeconds: env.HEARTBEAT_STALE_SECONDS,
  heartbeatOfflineSeconds: env.HEARTBEAT_OFFLINE_SECONDS,
};

export const settingsRepository = {
  async ensure(serverId: string): Promise<ServerSettings> {
    return prisma.serverSettings.upsert({
      where: { serverId },
      update: {},
      create: { serverId, ...DEFAULT_SETTINGS },
    });
  },

  async get(serverId: string): Promise<ServerSettings> {
    const existing = await prisma.serverSettings.findUnique({ where: { serverId } });
    if (existing) return existing;
    return this.ensure(serverId);
  },

  patch(serverId: string, data: Partial<SettingsData>): Promise<ServerSettings> {
    return prisma.serverSettings.update({ where: { serverId }, data });
  },
};
