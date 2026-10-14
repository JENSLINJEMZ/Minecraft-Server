/**
 * Pure bucketing/math helpers for the aggregation job. Kept free of Prisma so
 * they can be unit tested deterministically.
 */

export interface MetricSampleLike {
  tps1m: number | null;
  tps5m: number | null;
  tps15m: number | null;
  mspt: number | null;
  heapUsedBytes: bigint | number | null;
  heapMaxBytes: bigint | number | null;
  cpuUsagePercent: number | null;
}

export interface AggregateLike {
  tps1mAvg: number | null;
  tps5mAvg: number | null;
  tps15mAvg: number | null;
  msptAvg: number | null;
  msptMax: number | null;
  heapUsedAvg: number | null;
  heapMaxAvg: number | null;
  cpuAvg: number | null;
  playerCountAvg: number | null;
  playerCountMax: number | null;
  sampleCount: number;
}

export interface AggregateBucket {
  tps1mAvg: number | null;
  tps5mAvg: number | null;
  tps15mAvg: number | null;
  msptAvg: number | null;
  msptMax: number | null;
  heapUsedAvg: number | null;
  heapMaxAvg: number | null;
  cpuAvg: number | null;
  playerCountAvg: number | null;
  playerCountMax: number | null;
  sampleCount: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

export function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function toNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function maxOf(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

/** Roll a batch of raw metric samples (plus player counts from heartbeats) into one bucket. */
export function aggregateSamples(
  samples: MetricSampleLike[],
  playerCounts: number[] = [],
): AggregateBucket {
  return {
    tps1mAvg: average(samples.map((s) => s.tps1m)),
    tps5mAvg: average(samples.map((s) => s.tps5m)),
    tps15mAvg: average(samples.map((s) => s.tps15m)),
    msptAvg: average(samples.map((s) => s.mspt)),
    msptMax: maxOf(samples.map((s) => s.mspt)),
    heapUsedAvg: average(samples.map((s) => toNumber(s.heapUsedBytes))),
    heapMaxAvg: average(samples.map((s) => toNumber(s.heapMaxBytes))),
    cpuAvg: average(samples.map((s) => s.cpuUsagePercent)),
    playerCountAvg: average(playerCounts),
    playerCountMax: maxOf(playerCounts),
    sampleCount: samples.length,
  };
}

/** Roll 1-minute aggregates into a 1-hour aggregate. */
export function rollUpAggregates(rows: AggregateLike[]): AggregateBucket {
  return {
    tps1mAvg: average(rows.map((r) => r.tps1mAvg)),
    tps5mAvg: average(rows.map((r) => r.tps5mAvg)),
    tps15mAvg: average(rows.map((r) => r.tps15mAvg)),
    msptAvg: average(rows.map((r) => r.msptAvg)),
    msptMax: maxOf(rows.map((r) => r.msptMax)),
    heapUsedAvg: average(rows.map((r) => r.heapUsedAvg)),
    heapMaxAvg: average(rows.map((r) => r.heapMaxAvg)),
    cpuAvg: average(rows.map((r) => r.cpuAvg)),
    playerCountAvg: average(rows.map((r) => r.playerCountAvg)),
    playerCountMax: maxOf(rows.map((r) => r.playerCountMax)),
    sampleCount: rows.reduce((sum, r) => sum + r.sampleCount, 0),
  };
}
