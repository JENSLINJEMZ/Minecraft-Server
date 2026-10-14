import crypto from 'node:crypto';

/**
 * Agent credential tokens. The raw token is shown to the operator exactly once
 * (when created); only a SHA-256 hash is stored in the database.
 */

const TOKEN_PREFIX = 'mp_';
const PREFIX_LENGTH = 12;

export function generateAgentToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashAgentToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Short, non-secret prefix used for lookups and display. */
export function agentTokenPrefix(raw: string): string {
  return raw.slice(0, PREFIX_LENGTH);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Constant-time string compare for arbitrary-length secrets. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
