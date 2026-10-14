import http from 'node:http';
import { Server as IOServer } from 'socket.io';
import { createApp } from './app.js';
import { corsOrigins, env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { setupSocket } from './sockets/socketServer.js';
import { startJobs } from './jobs/scheduler.js';
import {
  ALERT_EVALUATION_INTERVAL_MS,
  runAlertEvaluation,
} from './services/alertService.js';
import { logger } from './utils/logger.js';

const app = createApp();
const httpServer = http.createServer(app);

const io = new IOServer(httpServer, {
  cors: { origin: corsOrigins, credentials: true },
  path: '/socket.io',
});

setupSocket(io);

let alertTimer: NodeJS.Timeout | null = null;
let stopJobs: (() => void) | null = null;

function scheduleAlertEvaluation(): void {
  const tick = (): void => {
    void runAlertEvaluation().catch((error) =>
      logger.warn({ err: error }, 'Alert evaluation tick failed'),
    );
  };
  // Evaluate once shortly after boot, then on a fixed cadence. The evaluator is
  // resilient to there being no rules (it returns early).
  const warmup = setTimeout(tick, 5_000);
  warmup.unref?.();
  alertTimer = setInterval(tick, ALERT_EVALUATION_INTERVAL_MS);
  alertTimer.unref?.();
}

httpServer.listen(env.API_PORT, env.API_BIND, () => {
  logger.info(
    { bind: env.API_BIND, port: env.API_PORT, env: env.NODE_ENV },
    'MinePulse API listening',
  );
  scheduleAlertEvaluation();
  stopJobs = startJobs();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  if (alertTimer) clearInterval(alertTimer);
  if (stopJobs) stopJobs();
  io.close();
  httpServer.close();
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
