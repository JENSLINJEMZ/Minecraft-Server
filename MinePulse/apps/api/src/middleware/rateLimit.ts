import rateLimit from 'express-rate-limit';

/** Strict limiter for the login route (brute-force protection). */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'too_many_requests', message: 'Too many login attempts, try later.' } },
});

/** Limiter for agent telemetry ingestion (protects the DB from floods). */
export const agentIngestRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.agent?.serverId ?? req.ip ?? 'unknown',
  message: { error: { code: 'too_many_requests', message: 'Ingestion rate limit exceeded.' } },
});
