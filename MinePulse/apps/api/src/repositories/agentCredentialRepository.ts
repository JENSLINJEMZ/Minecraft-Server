import { prisma } from '../lib/prisma.js';

export const agentCredentialRepository = {
  /** Look up a non-revoked credential by its short prefix (indexed). */
  findByPrefix(prefix: string) {
    return prisma.agentCredential.findMany({
      where: { tokenPrefix: prefix, revokedAt: null },
    });
  },

  create(input: { serverId: string; tokenPrefix: string; tokenHash: string; label?: string | null }) {
    return prisma.agentCredential.create({
      data: {
        serverId: input.serverId,
        tokenPrefix: input.tokenPrefix,
        tokenHash: input.tokenHash,
        label: input.label ?? null,
      },
    });
  },

  touchLastUsed(id: string) {
    return prisma.agentCredential
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch(() => null);
  },

  findById(id: string) {
    return prisma.agentCredential.findUnique({ where: { id } });
  },

  revoke(id: string) {
    return prisma.agentCredential.update({ where: { id }, data: { revokedAt: new Date() } });
  },

  listForServer(serverId: string) {
    return prisma.agentCredential.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tokenPrefix: true,
        label: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  },
};
