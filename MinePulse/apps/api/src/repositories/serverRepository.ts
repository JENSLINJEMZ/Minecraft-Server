import { prisma } from '../lib/prisma.js';
import type { Server } from '@prisma/client';

export const serverRepository = {
  /** v1 monitoring targets a single server; return the first one. */
  findPrimary(): Promise<Server | null> {
    return prisma.server.findFirst({ orderBy: { createdAt: 'asc' } });
  },

  /** All monitored servers (the jobs iterate these). */
  listAll(): Promise<Server[]> {
    return prisma.server.findMany({ orderBy: { createdAt: 'asc' } });
  },

  findById(id: string): Promise<Server | null> {
    return prisma.server.findUnique({ where: { id } });
  },

  async ensurePrimary(input: {
    name: string;
    minecraftVersion?: string | null;
    software?: string | null;
    address?: string | null;
  }): Promise<Server> {
    const existing = await this.findPrimary();
    if (existing) return existing;
    return prisma.server.create({
      data: {
        name: input.name,
        minecraftVersion: input.minecraftVersion ?? null,
        software: input.software ?? null,
        address: input.address ?? null,
        settings: { create: {} },
      },
    });
  },

  update(
    id: string,
    data: Partial<
      Pick<
        Server,
        | 'name'
        | 'minecraftVersion'
        | 'software'
        | 'address'
        | 'systemJson'
        | 'livePlayersJson'
        | 'liveBansJson'
      >
    >,
  ) {
    return prisma.server.update({ where: { id }, data });
  },
};
