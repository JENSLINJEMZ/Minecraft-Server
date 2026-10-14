import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface PluginInput {
  name: string;
  version: string;
  enabled: boolean;
  apiVersion: string | null;
}

export const pluginRepository = {
  /**
   * Store an inventory snapshot. Identical inventories (same hash) are deduped
   * and return null so we do not store duplicate plugin records.
   */
  async createSnapshot(input: {
    serverId: string;
    collectedAt: Date;
    inventoryHash: string;
    plugins: PluginInput[];
  }) {
    try {
      return await prisma.pluginSnapshot.create({
        data: {
          serverId: input.serverId,
          collectedAt: input.collectedAt,
          pluginCount: input.plugins.length,
          inventoryHash: input.inventoryHash,
          records: {
            create: input.plugins.map((p) => ({
              pluginName: p.name,
              version: p.version,
              enabled: p.enabled,
              apiVersion: p.apiVersion,
            })),
          },
        },
        include: { records: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  },

  latestSnapshot(serverId: string) {
    return prisma.pluginSnapshot.findFirst({
      where: { serverId },
      orderBy: { collectedAt: 'desc' },
      include: { records: { orderBy: { pluginName: 'asc' } } },
    });
  },

  snapshots(serverId: string, limit = 20) {
    return prisma.pluginSnapshot.findMany({
      where: { serverId },
      orderBy: { collectedAt: 'desc' },
      take: limit,
      include: { records: { orderBy: { pluginName: 'asc' } } },
    });
  },
};
