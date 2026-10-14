import type { Server as DbServer } from '@prisma/client';
import { serverRepository } from '../repositories/serverRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { AppError } from '../utils/errors.js';

/**
 * v1 monitors a single Paper server. Return it, creating a default row + settings
 * on first use so the API is usable before the agent has ever connected.
 */
export async function getPrimaryServer(): Promise<DbServer> {
  const server = await serverRepository.ensurePrimary({ name: 'Minecraft Server' });
  await settingsRepository.ensure(server.id);
  return server;
}

export async function requireServerById(id: string): Promise<DbServer> {
  const server = await serverRepository.findById(id);
  if (!server) throw AppError.unauthorized('Unknown server for this credential');
  return server;
}
