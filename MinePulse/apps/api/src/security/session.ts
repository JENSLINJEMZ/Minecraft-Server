import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** Cookie name for the dashboard session. */
export const SESSION_COOKIE = 'mp_session';

/** Session lifetime: 7 days. */
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/** Create a new opaque session id (not guessable). */
export function newSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Create a per-session CSRF token. */
export function newCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Sign a cookie value so it cannot be tampered with client-side. */
export function signValue(value: string): string {
  const mac = crypto.createHmac('sha256', env.SESSION_SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}

/** Verify a signed cookie value; returns the raw value or null. */
export function unsignValue(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', env.SESSION_SECRET)
    .update(value)
    .digest('base64url');
  return safeEqual(mac, expected) ? value : null;
}
