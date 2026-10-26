import { z } from 'zod';
import { isoDateTime } from './common.js';

/** Installed plugin inventory read models. */

/**
 * A change that has been staged on disk but is not live yet.
 *
 * Paper closes a plugin's class loader when it is disabled, and re-enabling the
 * same instance reuses that closed loader - which breaks class lookups for every
 * plugin sharing the loader group (player logins included). Plugin changes are
 * therefore staged as jar moves and applied by the next server start.
 */
export const PLUGIN_STAGED_STATES = ['enable', 'disable'] as const;
export const pluginStagedSchema = z.enum(PLUGIN_STAGED_STATES);
export type PluginStaged = z.infer<typeof pluginStagedSchema>;

export const pluginViewSchema = z.object({
  pluginName: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  /** Pending change for the next start; null when the live state is the target. */
  staged: pluginStagedSchema.nullable(),
  apiVersion: z.string().nullable(),
  author: z.string().nullable(),
  commandCount: z.number().int().nonnegative().nullable(),
});
export type PluginView = z.infer<typeof pluginViewSchema>;

export const pluginSnapshotSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  collectedAt: isoDateTime,
  pluginCount: z.number().int().nonnegative(),
  inventoryHash: z.string(),
  plugins: z.array(pluginViewSchema),
});
export type PluginSnapshot = z.infer<typeof pluginSnapshotSchema>;
