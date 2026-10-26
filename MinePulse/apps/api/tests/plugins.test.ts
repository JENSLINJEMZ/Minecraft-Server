import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: { pluginSnapshot: mocks },
}));

const { pluginRepository } = await import('../src/repositories/pluginRepository.js');

/** A real P2002 instance so `instanceof` inside the repository matches. */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError;
  Object.defineProperty(error, 'code', { value: 'P2002' });
  return error;
}

const plugins = [
  {
    name: 'HeadDrop',
    version: '3.1.0',
    enabled: true,
    apiVersion: null,
    author: 'Gab',
    commandCount: 0,
  },
];

const collectedAt = new Date('2026-10-26T07:20:28.198Z');
const input = {
  serverId: 'srv_1',
  collectedAt,
  inventoryHash: 'hash-enabled',
  plugins,
};

describe('plugin snapshot storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a snapshot when the inventory is new', async () => {
    const row = { id: 'snap_new', ...input, pluginCount: 1, records: [] };
    mocks.create.mockResolvedValueOnce(row);

    await expect(pluginRepository.createSnapshot(input)).resolves.toBe(row);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('re-touches an earlier identical snapshot instead of dropping it', async () => {
    // Disable a plugin, then enable it again: the old "enabled" hash comes
    // back. Dropping it would leave the newer "disabled" snapshot on top,
    // because latestSnapshot orders by collectedAt.
    const touched = { id: 'snap_old', ...input, pluginCount: 1, records: [] };
    mocks.create.mockRejectedValueOnce(uniqueViolation());
    mocks.findUnique.mockResolvedValueOnce({ id: 'snap_old' });
    mocks.update.mockResolvedValueOnce(touched);

    await expect(pluginRepository.createSnapshot(input)).resolves.toBe(touched);

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        serverId_inventoryHash: {
          serverId: 'srv_1',
          inventoryHash: 'hash-enabled',
        },
      },
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'snap_old' },
        data: expect.objectContaining({
          collectedAt,
          pluginCount: 1,
        }),
      }),
    );
  });

  it('returns null when the conflicting snapshot has vanished', async () => {
    mocks.create.mockRejectedValueOnce(uniqueViolation());
    mocks.findUnique.mockResolvedValueOnce(null);

    await expect(pluginRepository.createSnapshot(input)).resolves.toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rethrows errors that are not unique violations', async () => {
    const boom = new Error('database is down');
    mocks.create.mockRejectedValueOnce(boom);

    await expect(pluginRepository.createSnapshot(input)).rejects.toThrow('database is down');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
