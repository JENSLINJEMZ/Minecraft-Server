import { prisma } from '../lib/prisma.js';
import type { ModerationAction, PlayerFlag, PlayerNote } from '@prisma/client';

/**
 * Queue for moderation actions (dashboard -> API -> agent) plus the per-player
 * flags and notes that back the player profile. Actions are stored, never
 * executed here: the agent polls and runs them.
 */
export const moderationRepository = {
  create(input: {
    serverId: string;
    action: string;
    playerUuid?: string | null;
    playerName?: string | null;
    detail?: string | null;
    payloadJson?: string | null;
    requestedBy?: string | null;
  }): Promise<ModerationAction> {
    return prisma.moderationAction.create({
      data: {
        serverId: input.serverId,
        action: input.action,
        playerUuid: input.playerUuid ?? null,
        playerName: input.playerName ?? null,
        detail: input.detail ?? null,
        payloadJson: input.payloadJson ?? null,
        requestedBy: input.requestedBy ?? null,
      },
    });
  },

  findById(id: string): Promise<ModerationAction | null> {
    return prisma.moderationAction.findUnique({ where: { id } });
  },

  list(
    serverId: string,
    opts: { limit: number; playerUuid?: string },
  ): Promise<ModerationAction[]> {
    return prisma.moderationAction.findMany({
      where: { serverId, ...(opts.playerUuid ? { playerUuid: opts.playerUuid } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, opts.limit)),
    });
  },

  /**
   * Claim up to `limit` pending actions for the agent by flipping them to
   * "sent". Claiming (rather than plain reads) means a repeated poll never
   * re-runs an action the agent has already picked up.
   */
  async claimPending(serverId: string, limit: number): Promise<ModerationAction[]> {
    const pending = await prisma.moderationAction.findMany({
      where: { serverId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    if (pending.length === 0) return [];
    const ids = pending.map((a) => a.id);
    await prisma.moderationAction.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'sent', sentAt: new Date() },
    });
    return pending;
  },

  complete(id: string, ok: boolean, message: string | null): Promise<ModerationAction | null> {
    return prisma.moderationAction
      .update({
        where: { id },
        data: { status: ok ? 'done' : 'failed', resultMessage: message, completedAt: new Date() },
      })
      .catch(() => null);
  },

  /** Resume a stuck action (called when the agent reconnects). */
  async requeueStuck(serverId: string, olderThan: Date): Promise<number> {
    const res = await prisma.moderationAction.updateMany({
      where: { serverId, status: 'sent', sentAt: { lt: olderThan } },
      data: { status: 'pending', sentAt: null },
    });
    return res.count;
  },

  /* --- per-player flags ------------------------------------------------- */

  setMuted(serverId: string, playerUuid: string, muted: boolean): Promise<PlayerFlag> {
    return prisma.playerFlag.upsert({
      where: { serverId_playerUuid: { serverId, playerUuid } },
      create: { serverId, playerUuid, muted },
      update: { muted },
    });
  },

  async mutedUuids(serverId: string): Promise<string[]> {
    const rows = await prisma.playerFlag.findMany({
      where: { serverId, muted: true },
      select: { playerUuid: true },
    });
    return rows.map((r) => r.playerUuid);
  },

  async mutedSet(serverId: string): Promise<Set<string>> {
    return new Set(await this.mutedUuids(serverId));
  },

  /* --- notes ------------------------------------------------------------ */

  addNote(input: {
    serverId: string;
    playerUuid: string;
    kind: string;
    body: string;
    author: string;
  }): Promise<PlayerNote> {
    return prisma.playerNote.create({ data: input });
  },

  listNotes(serverId: string, playerUuid: string, limit = 50): Promise<PlayerNote[]> {
    return prisma.playerNote.findMany({
      where: { serverId, playerUuid },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
  },
};
