import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Assign a per-request id for correlation across logs and error responses. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
