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
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable().optional(),
  health: z.number().nonnegative().nullable().optional(),
  foodLevel: z.number().int().nonnegative().nullable().optional(),
  xpLevel: z.number().int().nonnegative().nullable().optional(),
  mobKills: z.number().int().nonnegative().nullable().optional(),
  deaths: z.number().int().nonnegative().nullable().optional(),
  blocksMined: z.number().int().nonnegative().nullable().optional(),
  clientBrand: z.string().nullable().optional(),
  // Moderation state. `muted` is the dashboard-set chat-mute flag; `banned` is
  // read from the server ban list reported with heartbeats.
  muted: z.boolean().optional(),
  banned: z.boolean().optional(),
  banReason: z.string().nullable().optional(),
  banExpiresAt: isoDateTime.nullable().optional(),
  banSource: z.string().nullable().optional(),
});
export type PlayerSummary = z.infer<typeof playerSummarySchema>;

/** A single staff note or warning recorded against a player. */
export const playerNoteSchema = z.object({
  id: z.string(),
  playerUuid: z.string().uuid(),
  kind: z.enum(['note', 'warning']),
  body: z.string(),
  author: z.string(),
  createdAt: isoDateTime,
});
export type PlayerNote = z.infer<typeof playerNoteSchema>;

/** Player detail: the summary plus notes, moderation flags and history count. */
export const playerDetailSchema = playerSummarySchema.extend({
  notes: z.array(playerNoteSchema),
});
export type PlayerDetail = z.infer<typeof playerDetailSchema>;

/** Daily playtime for one player, used by the profile playtime chart. */
export const playerDailyActivitySchema = z.object({
  day: z.string(),
  seconds: z.number().nonnegative(),
});
export type PlayerDailyActivity = z.infer<typeof playerDailyActivitySchema>;

/** One cause of death and how often it killed the player. */
export const playerDeathCauseSchema = z.object({
  cause: z.string(),
  count: z.number().int().nonnegative(),
});
export type PlayerDeathCause = z.infer<typeof playerDeathCauseSchema>;

/** Deaths-by-cause tally for one player, built from player_death events. */
export const playerDeathsSchema = z.object({
  uuid: z.string(),
  total: z.number().int().nonnegative(),
  causes: z.array(playerDeathCauseSchema),
});
export type PlayerDeaths = z.infer<typeof playerDeathsSchema>;

/** Restore state of one recorded death, from the moderation trail. */
export const deathRestoreStatusSchema = z.enum(['available', 'queued', 'restored', 'failed']);
export type DeathRestoreStatus = z.infer<typeof deathRestoreStatusSchema>;

/** One recorded death with its loot snapshot: what the player actually dropped. */
export const playerDeathSnapshotSchema = z.object({
  /** ServerEvent id; also the `deathId` used to restore. */
  id: z.string(),
  occurredAt: isoDateTime,
  /** Raw damage cause recorded by the agent. */
  cause: z.string(),
  /** Whether any loot dropped at all (false for keepInventory or an empty inventory). */
  dropped: z.boolean(),
  droppedItems: z.number().int().nonnegative(),
  droppedStacks: z.number().int().nonnegative(),
  keptInventory: z.boolean(),
  /** True when the snapshot was too large to store. */
  snapshotUnavailable: z.boolean().optional(),
  restoreStatus: deathRestoreStatusSchema,
});
export type PlayerDeathSnapshot = z.infer<typeof playerDeathSnapshotSchema>;

export const playerDeathSnapshotsSchema = z.object({
  uuid: z.string(),
  days: z.number().int().positive(),
  items: z.array(playerDeathSnapshotSchema),
});
export type PlayerDeathSnapshots = z.infer<typeof playerDeathSnapshotsSchema>;

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
