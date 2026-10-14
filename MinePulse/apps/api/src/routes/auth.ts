import { Router } from 'express';
import { loginSchema } from '@minepulse/shared';
import { loginRateLimit } from '../middleware/rateLimit.js';
import { login, logout } from '../services/authService.js';
import { parseOrThrow } from '../middleware/validate.js';
import { requireCsrf, requireUser } from '../middleware/auth.js';
import { isProduction } from '../config/env.js';
import { SESSION_COOKIE, signValue } from '../security/session.js';
import { toSessionUser } from '../services/dto.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(loginSchema, req.body);
    const result = await login(input.email, input.password);

    res.cookie(SESSION_COOKIE, signValue(result.sessionId), {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
      expires: result.expiresAt,
    });

    res.json({ user: result.user, csrfToken: result.csrfToken });
  }),
);

authRouter.post(
  '/logout',
  requireUser,
  requireCsrf,
  asyncHandler(async (req, res) => {
    if (req.session) await logout(req.session.id, req.user?.id ?? null);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireUser, (req, res) => {
  res.json({ user: toSessionUser(req.user!), csrfToken: req.session!.csrfToken });
});
