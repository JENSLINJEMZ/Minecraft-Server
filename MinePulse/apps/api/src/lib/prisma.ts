import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

/**
 * Single PrismaClient instance. In dev, reuse across tsx hot-reloads to avoid
 * exhausting database connections.
 *
 * Logging is wired through events so that expected unique-constraint
 * violations (P2002), which are used deliberately for dedupe, are not reported
 * as errors. Everything else is forwarded to the structured logger.
 */
const globalForPrisma = globalThis as unknown as { __minepulsePrisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  client.$on('warn', (event) => logger.warn({ prisma: event.message }, 'prisma warning'));
  client.$on('error', (event) => {
    // Dedupe relies on unique keys (heartbeats, metric batches, plugin
    // inventory hashes), so a P2002 here is normal control flow.
    if (event.message.includes('Unique constraint failed')) return;
    logger.error({ prisma: event.message }, 'prisma error');
  });

  return client;
}

export const prisma: PrismaClient = globalForPrisma.__minepulsePrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__minepulsePrisma = prisma;
}
