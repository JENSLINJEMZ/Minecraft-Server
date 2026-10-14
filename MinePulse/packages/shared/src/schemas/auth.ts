import { z } from 'zod';
import { isoDateTime } from './common.js';

/** Dashboard user authentication schemas. */

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userRoleSchema = z.enum(['admin', 'viewer']);

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: userRoleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const meResponseSchema = z.object({
  user: sessionUserSchema,
  csrfToken: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const loginResponseSchema = z.object({
  user: sessionUserSchema,
  csrfToken: z.string(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Bootstrap admin input (used only by the CLI, never an HTTP route). */
export const bootstrapAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(256),
});
export type BootstrapAdminInput = z.infer<typeof bootstrapAdminSchema>;

export const auditLogSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  createdAt: isoDateTime,
  metadata: z.record(z.unknown()).nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogSchema>;
