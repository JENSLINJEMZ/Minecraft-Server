import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters (OWASP-reasonable defaults for a private dashboard).
 * @node-rs/argon2 defaults to Argon2id, so we only tune cost parameters.
 */
const ARGON_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain, ARGON_OPTIONS);
  } catch {
    return false;
  }
}
