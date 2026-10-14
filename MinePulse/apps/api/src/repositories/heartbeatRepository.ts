import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ServerHeartbeat } from '@prisma/client';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const heartbeatRepository = {
  /**
   * Insert a heartbeat. Duplicate (serverId, sequence) or (serverId, requestId)
   * insertions are treated as idempotent no-ops and return null.
   */
  async create(data: {
    serverId: string;
    sequence: number;
    requestId: string;
    agentVersion: string;
    minecraftVersion: string | null;
    paperVersion: string | null;
    serverUptimeSeconds: number;
    playerCount: number;
    maxPlayers: number;
    status: string;
  }): Promise<ServerHeartbeat | null> {
    try {
      return await prisma.serverHeartbeat.create({ data });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  },

  latest(serverId: string): Promise<ServerHeartbeat | null> {
    return prisma.serverHeartbeat.findFirst({
      where: { serverId },
      orderBy: { receivedAt: 'desc' },
    });
  },
};
