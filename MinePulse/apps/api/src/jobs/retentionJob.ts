import { prisma } from '../lib/prisma.js';
import { serverRepository } from '../repositories/serverRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { logger } from '../utils/logger.js';

/**
 * Apply the per-server retention policy. Deletes are bounded by indexed time
 * columns and are safe to run repeatedly. Closed player sessions are pruned;
 * sessions that never closed are left alone so history is not lost.
 */

const DAY_MS = 86_400_000;

export interface RetentionCounts {
  metricSamples: number;
  aggregates1m: number;
  aggregates1h: number;
  events: number;
  playerSessions: number;
}

export async function runRetention(now: number = Date.now()): Promise<RetentionCounts> {
  const totals: RetentionCounts = {
    metricSamples: 0,
    aggregates1m: 0,
    aggregates1h: 0,
    events: 0,
    playerSessions: 0,
  };

  const servers = await serverRepository.listAll();
  for (const server of servers) {
    try {
      const settings = await settingsRepository.get(server.id);
      const dayAgo = (days: number): Date => new Date(now - days * DAY_MS);

      const [raw, a1m, a1h, events, sessions] = await Promise.all([
        prisma.metricSample.deleteMany({
          where: { serverId: server.id, recordedAt: { lt: dayAgo(settings.retentionRawMetricsDays) } },
        }),
        prisma.metricAggregate1m.deleteMany({
          where: { serverId: server.id, bucketStart: { lt: dayAgo(settings.retentionAggregated1mDays) } },
        }),
        prisma.metricAggregate1h.deleteMany({
          where: { serverId: server.id, bucketStart: { lt: dayAgo(settings.retentionAggregated1hDays) } },
        }),
        prisma.serverEvent.deleteMany({
          where: { serverId: server.id, occurredAt: { lt: dayAgo(settings.retentionEventsDays) } },
        }),
        prisma.playerSession.deleteMany({
          where: {
            serverId: server.id,
            leftAt: { not: null, lt: dayAgo(settings.retentionPlayerSessionsDays) },
          },
        }),
      ]);

      totals.metricSamples += raw.count;
      totals.aggregates1m += a1m.count;
      totals.aggregates1h += a1h.count;
      totals.events += events.count;
      totals.playerSessions += sessions.count;
    } catch (error) {
      logger.warn({ err: error, serverId: server.id }, 'Retention sweep failed for server');
    }
  }

  logger.info(totals, 'Retention sweep complete');
  return totals;
}
