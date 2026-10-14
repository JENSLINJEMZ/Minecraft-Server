import { z } from 'zod';
import { isoDateTime, paginationQuerySchema } from './common.js';

/** Read models for server info, status and metrics (API -> dashboard). */

export const serverInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  minecraftVersion: z.string().nullable(),
  software: z.string().nullable(),
  address: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type ServerInfo = z.infer<typeof serverInfoSchema>;

export const serverStateSchema = z.enum(['online', 'degraded', 'stale', 'offline']);

export const serverStatusSchema = z.object({
  serverId: z.string(),
  state: serverStateSchema,
  /** True when we recently received a heartbeat from the agent. */
  agentConnected: z.boolean(),
  minecraftVersion: z.string().nullable(),
  software: z.string().nullable(),
  /** Address players connect to ("host:port"), reported by the agent when known. */
  address: z.string().nullable(),
  playerCount: z.number().int().nullable(),
  maxPlayers: z.number().int().nullable(),
  uptimeSeconds: z.number().nullable(),
  lastHeartbeatAt: isoDateTime.nullable(),
  lastTelemetryAt: isoDateTime.nullable(),
  /** Age of the newest telemetry sample, in seconds. Null when there is none. */
  dataFreshnessSeconds: z.number().nullable(),
  /** Coarse health reason for the current state, e.g. "heartbeat overdue". */
  reason: z.string().nullable(),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

export const metricSampleSchema = z.object({
  recordedAt: isoDateTime,
  tps1m: z.number().nullable(),
  tps5m: z.number().nullable(),
  tps15m: z.number().nullable(),
  mspt: z.number().nullable(),
  heapUsedBytes: z.number().nullable(),
  heapMaxBytes: z.number().nullable(),
  heapCommittedBytes: z.number().nullable(),
  cpuUsagePercent: z.number().nullable(),
});
export type MetricSample = z.infer<typeof metricSampleSchema>;

/** Current snapshot: latest metrics sample plus latest heartbeat context. */
export const currentMetricsSchema = z.object({
  serverId: z.string(),
  sample: metricSampleSchema.nullable(),
  heapUsedPercent: z.number().nullable(),
  playerCount: z.number().int().nullable(),
  maxPlayers: z.number().int().nullable(),
  uptimeSeconds: z.number().nullable(),
  agentVersion: z.string().nullable(),
  lastHeartbeatAt: isoDateTime.nullable(),
});
export type CurrentMetrics = z.infer<typeof currentMetricsSchema>;

export const metricRangeSchema = z.enum(['15m', '1h', '6h', '24h', '7d']);

export const metricHistoryQuerySchema = paginationQuerySchema.extend({
  range: metricRangeSchema.default('1h'),
});
export type MetricHistoryQuery = z.infer<typeof metricHistoryQuerySchema>;

/** One point on a historical chart (already aggregated for long ranges). */
export const metricPointSchema = z.object({
  recordedAt: isoDateTime,
  tps1m: z.number().nullable(),
  tps5m: z.number().nullable(),
  tps15m: z.number().nullable(),
  mspt: z.number().nullable(),
  heapUsedBytes: z.number().nullable(),
  heapMaxBytes: z.number().nullable(),
  playerCount: z.number().int().nullable(),
  cpuUsagePercent: z.number().nullable(),
});
export type MetricPoint = z.infer<typeof metricPointSchema>;

export const metricHistorySchema = z.object({
  serverId: z.string(),
  range: metricRangeSchema,
  bucketSeconds: z.number().int(),
  points: z.array(metricPointSchema),
});
export type MetricHistory = z.infer<typeof metricHistorySchema>;
