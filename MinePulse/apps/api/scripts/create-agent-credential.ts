import { prisma } from '../src/lib/prisma.js';
import {
  agentTokenPrefix,
  generateAgentToken,
  hashAgentToken,
} from '../src/security/agentToken.js';
import { agentCredentialRepository } from '../src/repositories/agentCredentialRepository.js';
import { getPrimaryServer } from '../src/services/serverContext.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const label = arg('label') ?? 'default';
  const server = await getPrimaryServer();

  const token = generateAgentToken();
  const credential = await agentCredentialRepository.create({
    serverId: server.id,
    tokenPrefix: agentTokenPrefix(token),
    tokenHash: hashAgentToken(token),
    label,
  });

  // eslint-disable-next-line no-console
  console.log('\n== MinePulse agent credential created ==');
  // eslint-disable-next-line no-console
  console.log(`  Server   : ${server.name} (${server.id})`);
  // eslint-disable-next-line no-console
  console.log(`  Label    : ${label}`);
  // eslint-disable-next-line no-console
  console.log(`  Prefix   : ${credential.tokenPrefix}`);
  // eslint-disable-next-line no-console
  console.log(`  Token    : ${token}`);
  // eslint-disable-next-line no-console
  console.log('\n  Put this token in the plugin config.yml as agent-token.');
  // eslint-disable-next-line no-console
  console.log('  It is shown ONCE and stored only as a hash.\n');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to create agent credential:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
