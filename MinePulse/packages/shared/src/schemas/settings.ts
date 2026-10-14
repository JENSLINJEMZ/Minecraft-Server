import { z } from 'zod';

/** Retention + monitoring settings. */

export const settingsSchema = z.object({
  retentionRawMetricsDays: z.number().int().min(1).max(3650),
  retentionAggregated1mDays: z.number().int().min(1).max(3650),
  retentionAggregated1hDays: z.number().int().min(1).max(3650),
  retentionEventsDays: z.number().int().min(1).max(3650),
  retentionPlayerSessionsDays: z.number().int().min(1).max(3650),
  heartbeatStaleSeconds: z.number().int().min(5).max(3600),
  heartbeatOfflineSeconds: z.number().int().min(5).max(86400),
  /** Derived, read-only: whether a Discord webhook is configured. */
  discordConfigured: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsPatchSchema = settingsSchema
  .omit({ discordConfigured: true })
  .partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
