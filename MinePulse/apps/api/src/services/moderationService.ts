import type { ModerationAction, PlayerNote as DbPlayerNote } from '@prisma/client';
import {
  CONSOLE_CMD_LABELS,
  PLUGIN_ACTION_TO_VERB,
  type AgentAction,
  type ConsoleCommand,
  type ModerationActionType,
  type ModerationActionView,
  type PlayerActionRequest,
  type PlayerNote,
  type PluginAction,
  type PluginActionRequest,
} from '@minepulse/shared';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { chatRepository, toChatMessage } from '../repositories/chatRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors.js';
import { bus } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';

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
  'console',
  'plugin_enable',
  'plugin_disable',
  'plugin_reload',
]);

/** Audit-trail wording for each plugin verb. */
const PLUGIN_ACTION_LABELS: Record<PluginAction, string> = {
  enable: 'Enable',
  disable: 'Disable',
};

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
    case 'give':
      return `Give ${req.item} x${req.amount ?? 1} to ${playerName}`;
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
        : req.action === 'give'
          ? `Give ${req.item} x${req.amount ?? 1}`
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
      ...(req.item ? { item: req.item } : {}),
      ...(req.amount ? { amount: req.amount } : {}),
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

    // A warning issued from the Chat page cites a concrete message; flag it so
    // the badge and the Flagged counter reflect that real moderation decision.
    if (req.action === 'warn' && req.chatMessageId) {
      const flagged = await chatRepository.flagMessage(serverId, req.chatMessageId);
      if (flagged) {
        bus.publish('chat', { serverId, message: flagged });
      }
    }

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

  /**
   * Queue a fixed console command. `cmd` is a closed enum from the shared
   * schema; the agent maps each id onto exactly one console dispatch, so no
   * free-form command text ever leaves the dashboard.
   */
  async consoleAction(
    serverId: string,
    cmd: ConsoleCommand,
    actor: Actor | null,
  ): Promise<ModerationActionView> {
    const detail = CONSOLE_CMD_LABELS[cmd];
    const row = await moderationRepository.create({
      serverId,
      action: 'console',
      detail,
      payloadJson: JSON.stringify({ cmd }),
      requestedBy: actor?.email ?? null,
    });
    await auditRepository.create({
      userId: actor?.id ?? null,
      action: 'moderation.console',
      targetType: 'server',
      targetId: serverId,
      metadata: { cmd },
    });
    const view = toModerationView(row);
    bus.publish('action', { serverId, action: view });
    return view;
  },

  /**
   * Queue a plugin lifecycle action (enable/disable). The agent moves the jar
   * between `plugins/` and `plugins-disabled/`, so the change is applied by the
   * next server start. Live toggling is not offered: Paper closes a plugin's
   * class loader on disable, which breaks class lookups for other plugins.
   */
  async pluginAction(
    serverId: string,
    pluginName: string,
    req: PluginActionRequest,
    actor: Actor | null,
  ): Promise<ModerationActionView> {
    const verb = PLUGIN_ACTION_TO_VERB[req.action];
    const detail = `${PLUGIN_ACTION_LABELS[req.action]} plugin ${pluginName}`;
    const row = await moderationRepository.create({
      serverId,
      action: verb,
      detail,
      payloadJson: JSON.stringify({ plugin: pluginName }),
      requestedBy: actor?.email ?? null,
    });
    await auditRepository.create({
      userId: actor?.id ?? null,
      action: `moderation.${verb}`,
      targetType: 'plugin',
      targetId: pluginName,
      metadata: { plugin: pluginName },
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
          plugin: typeof payload.plugin === 'string' ? payload.plugin : null,
          cmd: typeof payload.cmd === 'string' ? payload.cmd : null,
          item: typeof payload.item === 'string' ? payload.item : null,
          amount: typeof payload.amount === 'number' ? payload.amount : null,
        };
      });
    return { actions, mutedUuids };
  },

  async complete(id: string, ok: boolean, message: string | null): Promise<void> {
    const row = await moderationRepository.complete(id, ok, message);
    if (!row) throw AppError.notFound('Unknown moderation action');
    // Push the finished action so the audit trail updates without a refresh.
    bus.publish('action', { serverId: row.serverId, action: toModerationView(row) });
    // A delivered broadcast becomes a real Chat row so the Chat page shows
    // what was actually sent, not merely what was queued.
    if (ok && row.action === 'broadcast' && row.detail && row.detail.trim().length > 0) {
      try {
        const chatRow = await chatRepository.insertBroadcast(
          row.serverId,
          `mod-${row.id}`,
          row.completedAt ?? new Date(),
          row.detail,
        );
        bus.publish('chat', { serverId: row.serverId, message: toChatMessage(chatRow) });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return; // Already recorded; broadcasts complete once.
        }
        logger.error({ err: error }, 'Failed to record broadcast chat row');
      }
    }
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
