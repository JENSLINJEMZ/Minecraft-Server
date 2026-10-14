import pino from 'pino';
import { env, isProduction } from '../config/env.js';

/**
 * Structured logger with redaction of secrets. Never log passwords, agent
 * tokens, cookies, authorization headers or webhook URLs.
 */
export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: undefined,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-agent-token"]',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'agentToken',
      'webhookUrl',
      '*.password',
      '*.token',
      '*.agentToken',
      '*.webhookUrl',
    ],
    censor: '[redacted]',
  },
  transport: isProduction
    ? undefined
    : {
        target: 'pino/file',
        options: { destination: 1 },
      },
});

export type Logger = typeof logger;
