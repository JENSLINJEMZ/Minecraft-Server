import crypto from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/security/password.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { getPrimaryServer } from '../src/services/serverContext.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function generatePassword(): string {
  // 24 url-safe chars; shown once, never stored in plaintext.
  return crypto.randomBytes(18).toString('base64url');
}

async function main(): Promise<void> {
  const email = arg('email')?.trim();
  const passwordArg = arg('password');

  if (!email) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: npm run bootstrap-admin -- --email you@example.com [--password <value>]',
    );
    process.exitCode = 1;
    return;
  }

  const existing = await userRepository.findByEmail(email);
  if (existing) {
    // eslint-disable-next-line no-console
    console.error(`A user with email "${email}" already exists. Nothing to do.`);
    process.exitCode = 1;
    return;
  }

  const password = passwordArg ?? generatePassword();
  if (password.length < 12) {
    // eslint-disable-next-line no-console
    console.error('Password must be at least 12 characters.');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await userRepository.create({ email, passwordHash, role: 'admin' });
  const server = await getPrimaryServer();

  // eslint-disable-next-line no-console
  console.log('\n== MinePulse admin created ==');
  // eslint-disable-next-line no-console
  console.log(`  Email   : ${user.email}`);
  if (!passwordArg) {
    // eslint-disable-next-line no-console
    console.log(`  Password: ${password}   <-- shown once, store it now`);
  } else {
    // eslint-disable-next-line no-console
    console.log('  Password: (the value you supplied)');
  }
  // eslint-disable-next-line no-console
  console.log(`  Server  : ${server.name} (${server.id})`);
  // eslint-disable-next-line no-console
  console.log('');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to bootstrap admin:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
