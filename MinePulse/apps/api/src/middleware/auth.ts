import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { SESSION_COOKIE, safeEqual, unsignValue } from '../security/session.js';
import { AppError } from '../utils/errors.js';

/**
 * Resolve the dashboard session from the signed cookie (if present) and attach
 * the user + session to the request. Never throws on a bad/expired cookie: it
 * simply leaves the request unauthenticated.
 */
export async function attachSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw || typeof raw !== 'string') return next();

    const id = unsignValue(raw);
    if (!id) return next();

    const session = await prisma.session.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!session) return next();
    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.session.delete({ where: { id } }).catch(() => null);
      return next();
    }

    req.user = session.user;
    req.session = { id: session.id, csrfToken: session.csrfToken };

    // Best-effort touch; failures must not break the request.
    void prisma.session
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch(() => null);

    next();
  } catch (error) {
    next(error);
  }
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(AppError.unauthorized());
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(AppError.unauthorized());
  if (req.user.role !== 'admin') return next(AppError.forbidden('Admin role required'));
  next();
}

/**
 * Double-submit CSRF protection: any state-changing request must carry the
 * per-session token in the `x-csrf-token` header.
 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.header('x-csrf-token');
  if (!req.session || !header || !safeEqual(header, req.session.csrfToken)) {
    return next(AppError.forbidden('Invalid or missing CSRF token'));
  }
  next();
}
