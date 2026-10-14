import { z } from 'zod';
import { isoDateTime, paginationQuerySchema } from './common.js';

/** Player read models. Players are always identified by UUID, never username. */

export const playerSummarySchema = z.object({
  uuid: z.string().uuid(),
  lastKnownUsername: z.string(),
  firstSeenAt: isoDateTime.nullable(),
  lastSeenAt: isoDateTime.nullable(),
  online: z.boolean(),
  currentSessionStartedAt: isoDateTime.nullable(),
  totalPlaytimeSeconds: z.number().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  // Live attributes reported with the latest heartbeat. Present only while the
  // player is online; null/absent otherwise.
  world: z.string().nullable().optional(),
  pingMs: z.number().int().nonnegative().nullable().optional(),
  gamemode: z.string().nullable().optional(),
  operator: z.boolean().optional(),
});
export type PlayerSummary = z.infer<typeof playerSummarySchema>;

export const playerSessionSchema = z.object({
  id: z.string(),
  playerUuid: z.string().uuid(),
  usernameAtJoin: z.string(),
  joinedAt: isoDateTime,
  leftAt: isoDateTime.nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
});
export type PlayerSession = z.infer<typeof playerSessionSchema>;

export const playerQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(64).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
export type PlayerQuery = z.infer<typeof playerQuerySchema>;

/** Daily/weekly activity aggregation for charts. */
export const activityPointSchema = z.object({
  day: z.string(),
  uniquePlayers: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  peakConcurrent: z.number().int().nonnegative(),
});
export type ActivityPoint = z.infer<typeof activityPointSchema>;

export const playerActivitySchema = z.object({
  serverId: z.string(),
  points: z.array(activityPointSchema),
});
export type PlayerActivity = z.infer<typeof playerActivitySchema>;

/** One bucket of the session-length histogram. */
export const sessionBucketSchema = z.object({
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type SessionBucket = z.infer<typeof sessionBucketSchema>;

/** Return-rate for one cohort age ("Day 1", "Day 7", "Day 30"). */
export const retentionPointSchema = z.object({
  label: z.string(),
  cohort: z.number().int().nonnegative(),
  pct: z.number().nullable(),
});
export type RetentionPoint = z.infer<typeof retentionPointSchema>;

/**
 * Aggregated player analytics for a trailing window, computed from stored
 * sessions and player records. Everything here is measured, never estimated.
 */
export const playersAnalyticsSchema = z.object({
  serverId: z.string(),
  windowHours: z.number().int().positive(),
  onlineNow: z.number().int().nonnegative(),
  maxPlayers: z.number().int().nullable(),
  uniquePlayers: z.number().int().nonnegative(),
  newPlayers: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  avgSessionSeconds: z.number().nonnegative().nullable(),
  sessionBuckets: z.array(sessionBucketSchema),
  retention: z.array(retentionPointSchema),
});
export type PlayersAnalytics = z.infer<typeof playersAnalyticsSchema>;
