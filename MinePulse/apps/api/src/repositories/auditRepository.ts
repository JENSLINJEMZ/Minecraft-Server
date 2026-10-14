import { prisma } from '../lib/prisma.js';

export const auditRepository = {
  create(input: {
    userId: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    return prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  },

  async list(page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count(),
    ]);
    return { items, total };
  },
};
