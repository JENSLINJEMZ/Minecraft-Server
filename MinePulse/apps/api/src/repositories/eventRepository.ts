import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ServerEvent as DbServerEvent } from '@prisma/client';
import type { ServerEventInput } from '@minepulse/shared';

export const eventRepository = {
  /**
   * Insert a batch of events, skipping any that violate the dedupe constraint
   * (serverId, requestId, occurredAt, eventType). SQLite has no createMany
   * skipDuplicates, so insert individually and treat unique clashes as no-ops.
   */
  async createMany(
    serverId: string,
    events: ServerEventInput[],
    requestId: string,
  ): Promise<{ inserted: number; duplicates: number; rows: DbServerEvent[] }> {
    let inserted = 0;
    let duplicates = 0;
    const rows: DbServerEvent[] = [];
    for (const event of events) {
      try {
        const row = await prisma.serverEvent.create({
          data: {
            serverId,
            eventType: event.type,
            severity: event.severity,
            occurredAt: new Date(event.occurredAt),
            summary: event.summary,
            detailsJson: event.details ? JSON.stringify(event.details) : null,
            requestId,
          },
        });
        rows.push(row);
        inserted++;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          duplicates++;
          continue;
        }
        throw error;
      }
    }
    return { inserted, duplicates, rows };
  },

  async list(params: {
    serverId: string;
    severity?: string;
    category?: string;
    from?: Date;
    to?: Date;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.ServerEventWhereInput = { serverId: params.serverId };
    if (params.severity) where.severity = params.severity;
    if (params.category) where.eventType = params.category;
    if (params.search) where.summary = { contains: params.search };
    if (params.from || params.to) {
      where.occurredAt = {};
      if (params.from) where.occurredAt.gte = params.from;
      if (params.to) where.occurredAt.lte = params.to;
    }
    const [items, total] = await Promise.all([
      prisma.serverEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.serverEvent.count({ where }),
    ]);
    return { items, total };
  },

  recent(serverId: string, limit = 20) {
    return prisma.serverEvent.findMany({
      where: { serverId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  },

  countSince(serverId: string, since: Date) {
    return prisma.serverEvent.count({ where: { serverId, occurredAt: { gte: since } } });
  },

  /** All events matching filters, without pagination (for CSV export, bounded). */
  listForExport(params: {
    serverId: string;
    severity?: string;
    category?: string;
    from?: Date;
    to?: Date;
    search?: string;
    max?: number;
  }) {
    const where: Prisma.ServerEventWhereInput = { serverId: params.serverId };
    if (params.severity) where.severity = params.severity;
    if (params.category) where.eventType = params.category;
    if (params.search) where.summary = { contains: params.search };
    if (params.from || params.to) {
      where.occurredAt = {};
      if (params.from) where.occurredAt.gte = params.from;
      if (params.to) where.occurredAt.lte = params.to;
    }
    return prisma.serverEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: params.max ?? 50000,
    });
  },
};
