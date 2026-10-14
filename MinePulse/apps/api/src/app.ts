import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { corsOrigins } from './config/env.js';
import { attachSession } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { agentRouter } from './routes/agent.js';
import { alertsRouter } from './routes/alerts.js';
import { authRouter } from './routes/auth.js';
import { exportRouter } from './routes/export.js';
import { serverRouter } from './routes/server.js';
import { settingsRouter } from './routes/settings.js';
import { logger } from './utils/logger.js';

/** Build the Express application (no listening here, so tests can import it). */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The dashboard is served from a different localhost port in dev.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-csrf-token', 'x-agent-token', 'x-request-id'],
      exposedHeaders: ['Content-Disposition'],
    }),
  );

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/health',
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachSession);

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/agent', agentRouter);
  app.use('/api/v1/server', serverRouter);
  app.use('/api/v1/alerts', alertsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/export', exportRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
