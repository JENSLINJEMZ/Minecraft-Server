import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../utils/errors.js';

/** Parse untrusted input with a Zod schema, throwing a 400 with details on failure. */
export function parseOrThrow<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.badRequest('Invalid request', result.error.flatten());
  }
  return result.data;
}
