import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { MetricSample } from '@prisma/client';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface MetricInput {
  serverId: string;
  sequence: number;
  requestId: string;
  recordedAt: Date;
  tps1m: number | null;
  tps5m: number | null;
  tps15m: number | null;
  mspt: number | null;
  heapUsedBytes: number | null;
  heapMaxBytes: number | null;
  heapCommittedBytes: number | null;
  cpuUsagePercent: number | null;
}

function toBigInt(value: number | null): bigint | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return BigInt(Math.max(0, Math.round(value)));
}

export const metricRepository = {
  async create(input: MetricInput): Promise<MetricSample | null> {
    try {
      return await prisma.metricSample.create({
        data: {
          serverId: input.serverId,
          sequence: input.sequence,
          requestId: input.requestId,
          recordedAt: input.recordedAt,
          tps1m: input.tps1m,
          tps5m: input.tps5m,
          tps15m: input.tps15m,
          mspt: input.mspt,
          heapUsedBytes: toBigInt(input.heapUsedBytes),
          heapMaxBytes: toBigInt(input.heapMaxBytes),
          heapCommittedBytes: toBigInt(input.heapCommittedBytes),
          cpuUsagePercent: input.cpuUsagePercent,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  },

  latest(serverId: string): Promise<MetricSample | null> {
    return prisma.metricSample.findFirst({
      where: { serverId },
      orderBy: { recordedAt: 'desc' },
    });
  },

  rawBetween(serverId: string, from: Date, to: Date, take = 2000) {
    return prisma.metricSample.findMany({
      where: { serverId, recordedAt: { gte: from, lte: to } },
      orderBy: { recordedAt: 'asc' },
      take,
    });
  },

  agg1mBetween(serverId: string, from: Date, to: Date) {
    return prisma.metricAggregate1m.findMany({
      where: { serverId, bucketStart: { gte: from, lte: to } },
      orderBy: { bucketStart: 'asc' },
    });
  },

  agg1hBetween(serverId: string, from: Date, to: Date) {
    return prisma.metricAggregate1h.findMany({
      where: { serverId, bucketStart: { gte: from, lte: to } },
      orderBy: { bucketStart: 'asc' },
    });
  },

  latestAgg1m(serverId: string) {
    return prisma.metricAggregate1m.findFirst({
      where: { serverId },
      orderBy: { bucketStart: 'desc' },
    });
  },

  oldestRaw(serverId: string) {
    return prisma.metricSample.findFirst({
      where: { serverId },
      orderBy: { recordedAt: 'asc' },
    });
  },
};
