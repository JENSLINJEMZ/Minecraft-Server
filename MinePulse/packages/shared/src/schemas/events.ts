import { z } from 'zod';
import { isoDateTime, paginationQuerySchema } from './common.js';

/** Structured monitoring events (searchable, filterable, exportable). */

export const serverEventSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  eventType: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  occurredAt: isoDateTime,
  receivedAt: isoDateTime,
  summary: z.string(),
  details: z.record(z.unknown()).nullable(),
  requestId: z.string().nullable(),
});
export type ServerEvent = z.infer<typeof serverEventSchema>;

export const eventQuerySchema = paginationQuerySchema.extend({
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  category: z.string().max(64).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  search: z.string().max(200).optional(),
});
export type EventQuery = z.infer<typeof eventQuerySchema>;
