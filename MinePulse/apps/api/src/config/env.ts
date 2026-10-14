import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Load .env from the API workspace (cwd) and, as a fallback, the repo root.
loadEnv({ path: path.resolve(process.cwd(), '.env') });
loadEnv({ path: path.resolve(process.cwd(), '..', '..', '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BIND: z.string().min(1).default('127.0.0.1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),

  HEARTBEAT_OFFLINE_SECONDS: z.coerce.number().int().min(5).default(60),
  HEARTBEAT_STALE_SECONDS: z.coerce.number().int().min(5).default(30),

  DISCORD_WEBHOOK_URL: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const discordConfigured = env.DISCORD_WEBHOOK_URL.trim().length > 0;
