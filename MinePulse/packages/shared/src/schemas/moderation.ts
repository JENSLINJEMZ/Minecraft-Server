import { z } from 'zod';
import { isoDateTime } from './common.js';

/**
 * Moderation read/write models.
 *
 * Every action is a fixed, typed verb. The website never sends a raw console
 * command: the agent maps each verb onto one specific Paper API call, so a
 * compromised dashboard cannot run arbitrary commands on the server.
 */

export const MODERATION_ACTIONS = [
  'kick',
  'ban',
  'unban',
  'op',
  'deop',
  'gamemode',
  'teleport',
  'message',
  'warn',
  'mute',
  'unmute',
] as const;
export const moderationActionTypeSchema = z.enum(MODERATION_ACTIONS);
export type ModerationActionType = z.infer<typeof moderationActionTypeSchema>;

export const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'] as const;
export const gamemodeSchema = z.enum(GAMEMODES);
export type Gamemode = z.infer<typeof gamemodeSchema>;

/** Body for POST /server/players/:uuid/action. */
export const playerActionRequestSchema = z
  .object({
    action: moderationActionTypeSchema,
    reason: z.string().max(500).optional(),
    mode: gamemodeSchema.optional(),
    text: z.string().max(500).optional(),
  })
  .refine((v) => v.action !== 'gamemode' || v.mode != null, {
    message: 'gamemode requires a mode',
    path: ['mode'],
  })
  .refine((v) => v.action !== 'warn' || (v.reason != null && v.reason.trim().length > 0), {
    message: 'warn requires a reason',
    path: ['reason'],
  })
  .refine((v) => v.action !== 'message' || (v.text != null && v.text.trim().length > 0), {
    message: 'message requires text',
    path: ['text'],
  });
export type PlayerActionRequest = z.infer<typeof playerActionRequestSchema>;

/** Body for POST /server/broadcast. */
export const broadcastRequestSchema = z.object({
  message: z.string().min(1).max(500),
});
export type BroadcastRequest = z.infer<typeof broadcastRequestSchema>;

export const noteKindSchema = z.enum(['note', 'warning']);
export type NoteKind = z.infer<typeof noteKindSchema>;

/** Body for POST /server/players/:uuid/notes. */
export const noteInputSchema = z.object({
  kind: noteKindSchema.default('note'),
  body: z.string().min(1).max(1000),
});
export type NoteInput = z.infer<typeof noteInputSchema>;

export const MODERATION_STATUSES = ['pending', 'sent', 'done', 'failed'] as const;
export const moderationStatusSchema = z.enum(MODERATION_STATUSES);
export type ModerationStatus = z.infer<typeof moderationStatusSchema>;

/** One queued/finished moderation action, as shown in the audit trail. */
export const moderationActionViewSchema = z.object({
  id: z.string(),
  action: moderationActionTypeSchema,
  playerUuid: z.string().nullable(),
  playerName: z.string().nullable(),
  detail: z.string().nullable(),
  status: moderationStatusSchema,
  resultMessage: z.string().nullable(),
  requestedBy: z.string().nullable(),
  createdAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
});
export type ModerationActionView = z.infer<typeof moderationActionViewSchema>;
