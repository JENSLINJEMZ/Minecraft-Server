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
  'give',
  'mute',
  'unmute',
  'console',
  'plugin_enable',
  'plugin_disable',
  'plugin_reload',
] as const;
export const moderationActionTypeSchema = z.enum(MODERATION_ACTIONS);
export type ModerationActionType = z.infer<typeof moderationActionTypeSchema>;

/**
 * Server console verbs. Each id maps to exactly one fixed console command in
 * the agent; a dashboard can never compose free-form console text. The ids
 * themselves (not Bukkit syntax) are what crosses the wire, so adding a command
 * means adding one enum entry and one dispatch line in the agent.
 */
export const CONSOLE_CMDS = [
  'save_all',
  'save_off',
  'save_on',
  'weather_clear',
  'weather_rain',
  'weather_thunder',
  'time_day',
  'time_noon',
  'time_night',
  'time_midnight',
  'whitelist_reload',
  'list',
  'tps',
] as const;
export const consoleCommandSchema = z.enum(CONSOLE_CMDS);
export type ConsoleCommand = z.infer<typeof consoleCommandSchema>;

/** Human-readable button/detail labels per console command. */
export const CONSOLE_CMD_LABELS: Record<ConsoleCommand, string> = {
  save_all: 'Save all worlds',
  save_off: 'Disable autosave',
  save_on: 'Enable autosave',
  weather_clear: 'Weather: clear',
  weather_rain: 'Weather: rain',
  weather_thunder: 'Weather: thunder',
  time_day: 'Time: day',
  time_noon: 'Time: noon',
  time_night: 'Time: night',
  time_midnight: 'Time: midnight',
  whitelist_reload: 'Reload whitelist',
  list: 'List online players',
  tps: 'Report TPS',
};

/** Body for POST /server/console. */
export const consoleRequestSchema = z.object({ cmd: consoleCommandSchema });
export type ConsoleRequest = z.infer<typeof consoleRequestSchema>;

/**
 * Plugin lifecycle verbs. They are stored as `plugin_<verb>` in the same queue
 * as the player verbs, so the agent keeps mapping one verb onto one file move.
 *
 * These are *staged*: the agent moves the jar between `plugins/` and
 * `plugins-disabled/`, and Paper applies the result on the next start. Loading
 * or unloading a plugin in a running JVM closes its class loader and poisons
 * class lookups for other plugins (observed breaking player logins), so live
 * toggling is deliberately not offered. `plugin_reload` is kept in the history
 * enum only so old audit rows still parse; it is no longer requestable.
 */
export const PLUGIN_ACTIONS = ['enable', 'disable'] as const;
export const pluginActionSchema = z.enum(PLUGIN_ACTIONS);
export type PluginAction = z.infer<typeof pluginActionSchema>;

export const PLUGIN_ACTION_VERBS = ['plugin_enable', 'plugin_disable', 'plugin_reload'] as const;
export const pluginActionVerbSchema = z.enum(PLUGIN_ACTION_VERBS);
export type PluginActionVerb = z.infer<typeof pluginActionVerbSchema>;

export const PLUGIN_ACTION_TO_VERB: Record<PluginAction, PluginActionVerb> = {
  enable: 'plugin_enable',
  disable: 'plugin_disable',
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
    /** `give` target material id (e.g. `diamond`, `iron_sword`). */
    item: z.string().trim().min(1).max(256).optional(),
    /** How many of the item to give. */
    amount: z.coerce.number().int().min(1).max(2304).optional(),
    /** When warning from the Chat page, flags the cited message. */
    chatMessageId: z.string().max(64).optional(),
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
  })
  .refine((v) => v.action !== 'give' || (v.item != null && v.item.trim().length > 0), {
    message: 'give requires an item id',
    path: ['item'],
  })
  .refine((v) => v.action !== 'console', {
    message: 'console commands go through POST /server/console',
    path: ['action'],
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
