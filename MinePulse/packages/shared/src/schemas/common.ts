import { z } from 'zod';

/** Standard pagination query (1-based page). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Envelope for any paginated list response. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Build a paginated response envelope. */
export function paginate<T>(items: T[], page: number, pageSize: number, total: number): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}

/** Consistent error body returned by the API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** ISO-8601 timestamp string. */
export const isoDateTime = z.string().datetime({ offset: true });

/** A single health probe response. */
export const healthSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: isoDateTime,
});
export type Health = z.infer<typeof healthSchema>;
