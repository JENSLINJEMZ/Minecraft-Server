import { z } from 'zod';
import { isoDateTime } from './common.js';

/** Persisted retention + monitoring settings. */
const settingsValuesSchema = z.object({
  retentionRawMetricsDays: z.number().int().min(1).max(3650),
  retentionAggregated1mDays: z.number().int().min(1).max(3650),
  retentionAggregated1hDays: z.number().int().min(1).max(3650),
  retentionEventsDays: z.number().int().min(1).max(3650),
  retentionPlayerSessionsDays: z.number().int().min(1).max(3650),
  heartbeatStaleSeconds: z.number().int().min(5).max(3600),
  heartbeatOfflineSeconds: z.number().int().min(5).max(86400),
});
export type SettingsValues = z.infer<typeof settingsValuesSchema>;

export const settingsSchema = settingsValuesSchema.extend({
  /** Derived, read-only: whether a Discord webhook is configured. */
  discordConfigured: z.boolean(),
  /** Repository/env defaults, used by the dashboard reset action. */
  defaults: settingsValuesSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = settingsValuesSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** A non-revoked agent credential with its secret hash omitted. */
export const agentCredentialSchema = z.object({
  id: z.string(),
  tokenPrefix: z.string(),
  label: z.string().nullable(),
  lastUsedAt: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type AgentCredential = z.infer<typeof agentCredentialSchema>;

export const agentCredentialCreateSchema = z.object({
  label: z.string().trim().max(60).optional(),
});
export type AgentCredentialCreate = z.infer<typeof agentCredentialCreateSchema>;

/** The raw token is returned exactly once, immediately after creation. */
export const agentCredentialCreatedSchema = agentCredentialSchema.extend({
  token: z.string(),
});
export type AgentCredentialCreated = z.infer<typeof agentCredentialCreatedSchema>;

export const settingsSecuritySchema = z.object({
  session: z.object({
    createdAt: isoDateTime,
    lastUsedAt: isoDateTime,
    expiresAt: isoDateTime,
  }),
  agentCredentials: z.array(agentCredentialSchema),
  team: z.array(
    z.object({
      id: z.string(),
      email: z.string().email(),
      role: z.enum(['admin', 'viewer']),
      createdAt: isoDateTime,
    }),
  ),
  apiBind: z.string(),
  sessionTtlSeconds: z.number().int(),
});
export type SettingsSecurity = z.infer<typeof settingsSecuritySchema>;
