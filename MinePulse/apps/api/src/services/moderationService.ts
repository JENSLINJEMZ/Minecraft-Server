import type { ModerationAction, PlayerNote as DbPlayerNote } from '@prisma/client';
import type {
  AgentAction,
  ModerationActionType,
  ModerationActionView,
  PlayerActionRequest,
  PlayerNote,
} from '@minepulse/shared';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { AppError } from '../utils/errors.js';
import { bus } from '../realtime/bus.js';

/** A dashboard user as passed to the service for attribution. */
export interface Actor {
  id: string;
  email: string;
}

/** Actions the agent executes remotely; mute/unmute are synced flags instead. */
const AGENT_ACTIONS: ReadonlySet<string> = new Set([
  'kick',
  'ban',
  'unban',
  'op',
  'deop',
  'gamemode',
  'teleport',
  'message',
  'broadcast',
  'warn',
]);

function parsePayload(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function toModerationView(row: ModerationAction): ModerationActionView {
  const payload = parsePayload(row.payloadJson);
  return {
    id: row.id,
    action: row.action as ModerationActionType,
    playerUuid: row.playerUuid,
    playerName: row.playerName,
    detail: row.detail,
    status: row.status as ModerationActionView['status'],
    resultMessage: row.resultMessage,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export function toPlayerNote(row: DbPlayerNote): PlayerNote {
  return {
    id: row.id,
    playerUuid: row.playerUuid,
    kind: row.kind === 'warning' ? 'warning' : 'note',
    body: row.body,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Human-readable one-liner for the audit trail. */
function describe(req: PlayerActionRequest, playerName: string, detail?: string | null): string {
  switch (req.action) {
    case 'kick':
      return `Kick ${playerName}${detail ? `: ${detail}` : ''}`;
    case 'ban':
      return `Ban ${playerName}${detail ? `: ${detail}` : ''}`;
    case 'unban':
      return `Unban ${playerName}`;
    case 'op':
      return `Make ${playerName} an operator`;
    case 'deop':
      return `Remove operator from ${playerName}`;
    case 'gamemode':
      return `Set ${playerName} gamemode to ${req.mode}`;
    case 'teleport':
      return `Teleport ${playerName} to spawn`;
    case 'message':
      return `Message to ${playerName}: ${detail}`;
    case 'warn':
      return `Warn ${playerName}: ${detail}`;
    case 'mute':
      return `Mute ${playerName}`;
    case 'unmute':
      return `Unmute ${playerName}`;
    default:
      return `${req.action} ${playerName}`;
  }
}

export const moderationService = {
  /**
   * Queue (or immediately apply) a player-targeted moderation action.
   * Returns the created action view, or null for pure flag changes.
   */
  async playerAction(
    serverId: string,
    player: { uuid: string; name: string },
    req: PlayerActionRequest,
    actor: Actor | null,
  ): Promise<ModerationActionView | null> {
    const actorId = actor?.id ?? null;

    if (req.action === 'mute' || req.action === 'unmute') {
      const muted = req.action === 'mute';
      await moderationRepository.setMuted(serverId, player.uuid, muted);
      await auditRepository.create({
        userId: actorId,
        action: `moderation.${req.action}`,
        targetType: 'player',
        targetId: player.uuid,
        metadata: { playerName: player.name },
      });
      return null;
    }

    const detail =
      req.action === 'gamemode'
        ? req.mode ?? null
        : req.action === 'message' || req.action === 'warn'
          ? (req.text ?? req.reason ?? null)
          : (req.reason ?? null);

    if (req.action === 'warn') {
      await moderationRepository.addNote({
        serverId,
        playerUuid: player.uuid,
        kind: 'warning',
        body: detail ?? 'Warning issued',
        author: actor?.email ?? 'system',
      });
    }

    const payload = {
      ...(req.reason ? { reason: req.reason } : {}),
      ...(req.mode ? { mode: req.mode } : {}),
      ...(req.text ? { text: req.text } : {}),
    };

    const row = await moderationRepository.create({
      serverId,
      action: req.action,
      playerUuid: player.uuid,
      playerName: player.name,
      detail,
      payloadJson: JSON.stringify(payload),
      requestedBy: actor?.email ?? null,
    });

    await auditRepository.create({
      userId: actorId,
      action: `moderation.${req.action}`,
      targetType: 'player',
      targetId: player.uuid,
      metadata: { playerName: player.name, detail },
    });

    const view = toModerationView(row);
    // Push the queued action so open dashboards show it instantly.
    bus.publish('action', { serverId, action: view });
    return view;
  },

  /** Queue a server-wide broadcast to all online players. */
  async broadcast(serverId: string, message: string, actor: Actor | null): Promise<ModerationActionView> {
    const row = await moderationRepository.create({
      serverId,
      action: 'broadcast',
      detail: message,
      payloadJson: JSON.stringify({ text: message }),
      requestedBy: actor?.email ?? null,
    });
    await auditRepository.create({
      userId: actor?.id ?? null,
      action: 'moderation.broadcast',
      targetType: 'server',
      targetId: serverId,
      metadata: { message },
    });
    const view = toModerationView(row);
    bus.publish('action', { serverId, action: view });
    return view;
  },

  async list(serverId: string, limit: number, playerUuid?: string): Promise<ModerationActionView[]> {
    const rows = await moderationRepository.list(serverId, { limit, playerUuid });
    return rows.map(toModerationView);
  },

  /** Work handed to the agent on each poll: pending actions + the mute list. */
  async pendingForAgent(
    serverId: string,
  ): Promise<{ actions: AgentAction[]; mutedUuids: string[] }> {
    const [rows, mutedUuids] = await Promise.all([
      moderationRepository.claimPending(serverId, 50),
      moderationRepository.mutedUuids(serverId),
    ]);
    const actions: AgentAction[] = rows
      .filter((row) => AGENT_ACTIONS.has(row.action))
      .map((row) => {
        const payload = parsePayload(row.payloadJson);
        return {
          id: row.id,
          action: row.action as AgentAction['action'],
          targetUuid: row.playerUuid,
          targetName: row.playerName,
          reason: typeof payload.reason === 'string' ? payload.reason : null,
          mode: typeof payload.mode === 'string' ? payload.mode : null,
          text: typeof payload.text === 'string' ? payload.text : null,
        };
      });
    return { actions, mutedUuids };
  },

  async complete(id: string, ok: boolean, message: string | null): Promise<void> {
    const row = await moderationRepository.complete(id, ok, message);
    if (!row) throw AppError.notFound('Unknown moderation action');
    // Push the finished action so the audit trail updates without a refresh.
    bus.publish('action', { serverId: row.serverId, action: toModerationView(row) });
  },

  async setMuted(serverId: string, playerUuid: string, muted: boolean): Promise<void> {
    await moderationRepository.setMuted(serverId, playerUuid, muted);
  },

  async addNote(
    serverId: string,
    playerUuid: string,
    kind: 'note' | 'warning',
    body: string,
    author: string,
  ): Promise<PlayerNote> {
    const row = await moderationRepository.addNote({ serverId, playerUuid, kind, body, author });
    return toPlayerNote(row);
  },

  async notes(serverId: string, playerUuid: string): Promise<PlayerNote[]> {
    const rows = await moderationRepository.listNotes(serverId, playerUuid);
    return rows.map(toPlayerNote);
  },

  async flags(serverId: string, playerUuid: string): Promise<{ muted: boolean }> {
    const muted = await moderationRepository.mutedSet(serverId);
    return { muted: muted.has(playerUuid) };
  },
};
