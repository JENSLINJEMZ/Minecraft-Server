import type { Server as DbServer, MetricAggregate1h, MetricAggregate1m, MetricSample as DbMetricSample } from '@prisma/client';
import type { MetricHistory, MetricPoint } from '@minepulse/shared';
import { metricRepository } from '../repositories/metricRepository.js';
import {
  metricPointFromAgg1h,
  metricPointFromAgg1m,
  metricPointFromRaw,
} from './dto.js';

interface RangeConfig {
  ms: number;
  bucketSeconds: number;
  source: 'raw' | 'agg1m' | 'agg1h';
}

const RANGES: Record<string, RangeConfig> = {
  '15m': { ms: 15 * 60 * 1000, bucketSeconds: 0, source: 'raw' },
  '1h': { ms: 60 * 60 * 1000, bucketSeconds: 0, source: 'raw' },
  '6h': { ms: 6 * 60 * 60 * 1000, bucketSeconds: 60, source: 'agg1m' },
  '24h': { ms: 24 * 60 * 60 * 1000, bucketSeconds: 60, source: 'agg1m' },
  '7d': { ms: 7 * 24 * 60 * 60 * 1000, bucketSeconds: 3600, source: 'agg1h' },
};

/**
 * Return chart-ready history for a range. Long ranges prefer the rollup tables
 * and transparently fall back to raw samples when rollups are not present yet
 * (e.g. before the aggregation job has run).
 */
export async function getHistory(
  server: DbServer,
  range: keyof typeof RANGES,
): Promise<MetricHistory> {
  const config = RANGES[range] ?? RANGES['1h']!;
  const to = new Date();
  const from = new Date(to.getTime() - config.ms);

  let points: MetricPoint[] = [];
  let bucketSeconds = config.bucketSeconds;

  if (config.source === 'raw') {
    const rows = await metricRepository.rawBetween(server.id, from, to);
    points = rows.map(metricPointFromRaw);
  } else if (config.source === 'agg1m') {
    const rows = await metricRepository.agg1mBetween(server.id, from, to);
    if (rows.length > 0) {
      points = rows.map((r: MetricAggregate1m) => metricPointFromAgg1m(r));
    } else {
      const fallback = await metricRepository.rawBetween(server.id, from, to);
      points = fallback.map(metricPointFromRaw);
      bucketSeconds = 0;
    }
  } else {
    const rows = await metricRepository.agg1hBetween(server.id, from, to);
    if (rows.length > 0) {
      points = rows.map((r: MetricAggregate1h) => metricPointFromAgg1h(r));
    } else {
      const fallback: DbMetricSample[] = await metricRepository.rawBetween(server.id, from, to);
      points = fallback.map(metricPointFromRaw);
      bucketSeconds = 0;
    }
  }

  return { serverId: server.id, range: range as MetricHistory['range'], bucketSeconds, points };
}

export const metricsService = { getHistory };
