import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface PluginInput {
  name: string;
  version: string;
  enabled: boolean;
  staged: string | null;
  apiVersion: string | null;
  author: string | null;
  commandCount: number | null;
}

export const pluginRepository = {
  /**
   * Store an inventory snapshot. Identical inventories (same hash) are deduped
   * so we do not store duplicate plugin records.
   *
   * A dedupe hit is not always "nothing to do": the server can return to an
   * inventory it had before (disable a plugin, then enable it again). That
   * hash already exists from the earlier visit, but the snapshot on top is now
   * the stale disabled one. Because `latestSnapshot` orders by `collectedAt`,
   * dropping the post would leave the UI stuck on the stale state forever.
   * So the existing row is re-touched and becomes the latest view again.
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
              staged: p.staged,
              apiVersion: p.apiVersion,
              author: p.author,
              commandCount: p.commandCount,
            })),
          },
        },
        include: { records: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const existing = await prisma.pluginSnapshot.findUnique({
        where: {
          serverId_inventoryHash: {
            serverId: input.serverId,
            inventoryHash: input.inventoryHash,
          },
        },
      });
      if (!existing) return null;

      return await prisma.pluginSnapshot.update({
        where: { id: existing.id },
        data: {
          collectedAt: input.collectedAt,
          receivedAt: new Date(),
          pluginCount: input.plugins.length,
        },
        include: { records: { orderBy: { pluginName: 'asc' } } },
      });
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
