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
