import { pluginRepository } from '../repositories/pluginRepository.js';
import { toPluginSnapshot } from './dto.js';
import type { PluginSnapshot } from '@minepulse/shared';

export const pluginsService = {
  async latest(serverId: string): Promise<PluginSnapshot | null> {
    const snap = await pluginRepository.latestSnapshot(serverId);
    return snap ? toPluginSnapshot(snap) : null;
  },

  async history(serverId: string, limit = 20): Promise<PluginSnapshot[]> {
    const snaps = await pluginRepository.snapshots(serverId, limit);
    return snaps.map(toPluginSnapshot);
  },
};
