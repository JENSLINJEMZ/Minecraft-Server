import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isProduction } from '../config/env.js';

/** Terminal 404 handler. */
export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `Route not found: ${req.method} ${req.path}`, requestId: req.id },
  });
}

/** Centralized error handler. Never leaks stack traces in production. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = req.id;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, 'Application error');
    }
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, requestId, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Invalid request', requestId, details: err.flatten() },
    });
    return;
  }

  // Body-parser style errors
  if (typeof err === 'object' && err !== null && 'status' in err && 'type' in err) {
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 400).json({
      error: { code: 'bad_request', message: e.message ?? 'Bad request', requestId },
    });
    return;
  }

  logger.error({ err, requestId }, 'Unhandled error');
  const detail =
    !isProduction && err instanceof Error ? { message: err.message } : undefined;
  res.status(500).json({
    error: { code: 'internal_error', message: 'Internal server error', requestId, details: detail },
  });
}
