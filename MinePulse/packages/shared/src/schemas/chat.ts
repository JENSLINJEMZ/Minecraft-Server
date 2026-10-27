import { z } from 'zod';
import { isoDateTime } from './common.js';

/**
 * Read models for the live Chat page. Chat rows are the `chat_message`
 * events reported by the Paper agent; no local content is invented.
 */

export type ChatSource = 'chat' | 'broadcast';

/** One row of the chat log as returned by `GET /api/v1/server/chat`. */
export const chatMessageSchema = z.object({
  id: z.string(),
  eventType: z.literal('chat_message'),
  occurredAt: isoDateTime,
  playerId: z.string().optional(),
  playerName: z.string().optional(),
  message: z.string(),
  flagged: z.boolean().default(false),
  /** Current mute state of the message's author (true for broadcasts: false). */
  muted: z.boolean().default(false),
  source: z.enum(['chat', 'broadcast']).default('chat'),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Query options for the chat log. `flagged`/`source` are sent as strings. */
export const chatMessageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
  /** Case-sensitive substring over the raw `PlayerName: message` summary. */
  search: z.string().max(200).optional(),
  /** Exact player-name filter; matches `PlayerName:` message prefixes only. */
  playerName: z.string().max(64).optional(),
  flagged: z
    .string()
    .optional()
    .transform((raw) => raw === 'true'),
  source: z.enum(['chat', 'broadcast']).optional(),
});
export type ChatMessageQuery = z.infer<typeof chatMessageQuerySchema>;

/** Counters used by the chat page's KPI boxes (always real data). */
export const chatStatsSchema = z.object({
  messages: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
  broadcasts: z.number().int().nonnegative(),
  mutedPlayers: z.number().int().nonnegative(),
});
export type ChatStats = z.infer<typeof chatStatsSchema>;

/** The whole page payload: rows + their independent counters. */
export const chatPageSchema = z.object({
  items: z.array(chatMessageSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  stats: chatStatsSchema,
});
export type ChatPage = z.infer<typeof chatPageSchema>;
