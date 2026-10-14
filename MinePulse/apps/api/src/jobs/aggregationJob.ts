import { prisma } from '../lib/prisma.js';
import { serverRepository } from '../repositories/serverRepository.js';
import { aggregateSamples, floorToHour, floorToMinute, rollUpAggregates } from '../services/aggregation.js';
import { logger } from '../utils/logger.js';

/**
 * Roll raw metric samples into 1-minute aggregates, then 1-minute aggregates
 * into 1-hour aggregates. Every write is an upsert keyed on
 * (serverId, bucketStart), so running the job repeatedly is idempotent: a
 * partially-filled current bucket is simply recomputed on the next tick.
 */

const MAX_MINUTE_BUCKETS_PER_RUN = 720; // up to 12h of catch-up in one tick
const MAX_HOUR_BUCKETS_PER_RUN = 48; // up to 2 days
const OVERLAP_MS = 2 * 60_000; // recompute the two most recent buckets

export async function runAggregation(now: number = Date.now()): Promise<void> {
  const servers = await serverRepository.listAll();
  for (const server of servers) {
    try {
      await rollupMinutes(server.id, now);
      await rollupHours(server.id, now);
    } catch (error) {
      logger.warn({ err: error, serverId: server.id }, 'Aggregation failed for server');
    }
  }
}

async function rollupMinutes(serverId: string, now: number): Promise<void> {
  const currentBucket = floorToMinute(now);
  const oldest = await prisma.metricSample.findFirst({
    where: { serverId },
    orderBy: { recordedAt: 'asc' },
    select: { recordedAt: true },
  });
  if (!oldest) return;

  const latest = await prisma.metricAggregate1m.findFirst({
    where: { serverId },
    orderBy: { bucketStart: 'desc' },
    select: { bucketStart: true },
  });

  const floor = currentBucket - (MAX_MINUTE_BUCKETS_PER_RUN - 1) * 60_000;
  const start = Math.max(
    latest ? latest.bucketStart.getTime() - OVERLAP_MS : floorToMinute(oldest.recordedAt.getTime()),
    floor,
  );

  for (let b = start; b <= currentBucket; b += 60_000) {
    const bucketStart = new Date(b);
    const bucketEnd = new Date(b + 60_000);
    const [samples, heartbeats] = await Promise.all([
      prisma.metricSample.findMany({
        where: { serverId, recordedAt: { gte: bucketStart, lt: bucketEnd } },
      }),
      prisma.serverHeartbeat.findMany({
        where: { serverId, receivedAt: { gte: bucketStart, lt: bucketEnd } },
        select: { playerCount: true },
      }),
    ]);
    if (samples.length === 0) continue;

    const bucket = aggregateSamples(
      samples,
      heartbeats.map((h) => h.playerCount),
    );
    await prisma.metricAggregate1m.upsert({
      where: { serverId_bucketStart: { serverId, bucketStart } },
      create: { serverId, bucketStart, ...bucket },
      update: { ...bucket },
    });
  }
}

async function rollupHours(serverId: string, now: number): Promise<void> {
  const currentHour = floorToHour(now);
  const first = await prisma.metricAggregate1m.findFirst({
    where: { serverId },
    orderBy: { bucketStart: 'asc' },
    select: { bucketStart: true },
  });
  if (!first) return;

  const latest = await prisma.metricAggregate1h.findFirst({
    where: { serverId },
    orderBy: { bucketStart: 'desc' },
    select: { bucketStart: true },
  });

  const floor = currentHour - (MAX_HOUR_BUCKETS_PER_RUN - 1) * 3_600_000;
  const start = Math.max(
    latest ? latest.bucketStart.getTime() - 2 * 3_600_000 : floorToHour(first.bucketStart.getTime()),
    floor,
  );

  for (let h = start; h <= currentHour; h += 3_600_000) {
    const bucketStart = new Date(h);
    const bucketEnd = new Date(h + 3_600_000);
    const rows = await prisma.metricAggregate1m.findMany({
      where: { serverId, bucketStart: { gte: bucketStart, lt: bucketEnd } },
    });
    if (rows.length === 0) continue;

    const bucket = rollUpAggregates(rows);
    await prisma.metricAggregate1h.upsert({
      where: { serverId_bucketStart: { serverId, bucketStart } },
      create: { serverId, bucketStart, ...bucket },
      update: { ...bucket },
    });
  }
}
