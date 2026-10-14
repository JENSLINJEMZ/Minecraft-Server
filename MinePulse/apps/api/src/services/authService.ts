import { prisma } from '../lib/prisma.js';
import { verifyPassword } from '../security/password.js';
import { newCsrfToken, newSessionId, sessionExpiry } from '../security/session.js';
import { userRepository } from '../repositories/userRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { toSessionUser } from './dto.js';
import { AppError } from '../utils/errors.js';
import type { SessionUser } from '@minepulse/shared';

export interface LoginResult {
  user: SessionUser;
  sessionId: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Verify credentials and create a session. Uses a generic error message so the
 * response never reveals whether an email exists.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await userRepository.findByEmail(email);
  if (!user) {
    // Still run a dummy verification to reduce timing signal.
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      password,
    );
    throw AppError.unauthorized('Invalid email or password');
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw AppError.unauthorized('Invalid email or password');

  const id = newSessionId();
  const csrfToken = newCsrfToken();
  const expiresAt = sessionExpiry();

  await prisma.session.create({ data: { id, userId: user.id, csrfToken, expiresAt } });
  await auditRepository.create({ userId: user.id, action: 'auth.login' });

  return { user: toSessionUser(user), sessionId: id, csrfToken, expiresAt };
}

export async function logout(sessionId: string, userId: string | null): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => null);
  if (userId) {
    await auditRepository.create({ userId, action: 'auth.logout' });
  }
}
