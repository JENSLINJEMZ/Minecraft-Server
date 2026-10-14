import { z } from 'zod';
import { isoDateTime } from './common.js';

/** Installed plugin inventory read models. */

export const pluginViewSchema = z.object({
  pluginName: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  apiVersion: z.string().nullable(),
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
