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
  'plugin_enable',
  'plugin_disable',
  'plugin_reload',
] as const;
export const moderationActionTypeSchema = z.enum(MODERATION_ACTIONS);
export type ModerationActionType = z.infer<typeof moderationActionTypeSchema>;

/**
 * Plugin lifecycle verbs. They are stored as `plugin_<verb>` in the same queue
 * as the player verbs, so the agent keeps mapping one verb onto one Paper API
 * call. Plugin state is runtime-only: it reverts on the next server start
 * because the jar is still present.
 */
export const PLUGIN_ACTIONS = ['enable', 'disable', 'reload'] as const;
export const pluginActionSchema = z.enum(PLUGIN_ACTIONS);
export type PluginAction = z.infer<typeof pluginActionSchema>;

export const PLUGIN_ACTION_VERBS = ['plugin_enable', 'plugin_disable', 'plugin_reload'] as const;
export const pluginActionVerbSchema = z.enum(PLUGIN_ACTION_VERBS);
export type PluginActionVerb = z.infer<typeof pluginActionVerbSchema>;

export const PLUGIN_ACTION_TO_VERB: Record<PluginAction, PluginActionVerb> = {
  enable: 'plugin_enable',
  disable: 'plugin_disable',
  reload: 'plugin_reload',
};

/** Body for POST /server/plugins/:name/action. */
export const pluginActionRequestSchema = z.object({ action: pluginActionSchema });
export type PluginActionRequest = z.infer<typeof pluginActionRequestSchema>;

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
