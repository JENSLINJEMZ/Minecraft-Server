import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ServerEvent as DbServerEvent } from '@prisma/client';
import type { ChatMessage, ChatMessageQuery, ChatStats } from '@minepulse/shared';

/**
 * Chat reads the `chat_message` rows that arrived on the normal structured
 * event path. Every counter is computed from those rows only; nothing here is
 * invented. SQLite cannot query inside JSON, so flag/broadcast filters use the
 * compact JSON substrings produced by `JSON.stringify` at capture time.
 */
const CHAT_EVENT_TYPE = 'chat_message';

function parseDetails(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Map a persisted `chat_message` row to the shared read model. */
export function toChatMessage(row: DbServerEvent, mutedUuids?: ReadonlySet<string>): ChatMessage {
  const details = parseDetails(row.detailsJson);
  const source = details.source === 'broadcast' ? 'broadcast' : 'chat';
  const playerId = asText(details.uuid);
  return {
    id: row.id,
    eventType: CHAT_EVENT_TYPE,
    occurredAt: row.occurredAt.toISOString(),
    playerId,
    playerName:
      asText(details.username) ?? (source === 'broadcast' ? '[Server]' : undefined),
    message: asText(details.message) ?? row.summary,
    flagged: details.flagged === true,
    muted: playerId != null && (mutedUuids?.has(playerId) ?? false),
    source,
  };
}

function buildWhere(serverId: string, params: ChatMessageQuery): Prisma.ServerEventWhereInput {
  const where: Prisma.ServerEventWhereInput = { serverId, eventType: CHAT_EVENT_TYPE };
  if (params.search) where.summary = { contains: params.search };
  if (params.playerName) {
    // Real chat summaries are `playerName: message`; broadcasts are not.
    where.summary = { startsWith: `${params.playerName}:` };
  }
  if (params.flagged) where.detailsJson = { contains: '"flagged":true' };
  if (params.source === 'broadcast') where.detailsJson = { contains: '"source":"broadcast"' };
  return where;
}

export const chatRepository = {
  async list(
    serverId: string,
    params: ChatMessageQuery,
  ): Promise<{ items: ChatMessage[]; total: number }> {
    const where = buildWhere(serverId, params);
    const [rows, total] = await Promise.all([
      prisma.serverEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.serverEvent.count({ where }),
    ]);
    const muted = await this.mutedFor(serverId, rows);
    return { items: rows.map((row) => toChatMessage(row, muted)), total };
  },

  /** Mute state for the authors present in a page of chat rows. */
  async mutedFor(serverId: string, rows: DbServerEvent[]): Promise<Set<string>> {
    const uuids = rows
      .map((row) => asText(parseDetails(row.detailsJson).uuid))
      .filter((uuid): uuid is string => uuid != null);
    if (uuids.length === 0) return new Set();
    const flags = await prisma.playerFlag.findMany({
      where: { serverId, muted: true, playerUuid: { in: uuids } },
      select: { playerUuid: true },
    });
    return new Set(flags.map((flag) => flag.playerUuid));
  },

  /** Mark the cited chat message flagged after a warning is queued. */
  async flagMessage(serverId: string, id: string): Promise<ChatMessage | null> {
    const row = await prisma.serverEvent.findFirst({
      where: { id, serverId, eventType: CHAT_EVENT_TYPE },
    });
    if (!row) return null;
    const details = parseDetails(row.detailsJson);
    if (details.flagged !== true) {
      details.flagged = true;
      const updated = await prisma.serverEvent.update({
        where: { id: row.id },
        data: { detailsJson: JSON.stringify(details) },
      });
      return toChatMessage(updated);
    }
    return toChatMessage(row);
  },

  async stats(serverId: string): Promise<ChatStats> {
    const [messages, flagged, broadcasts, mutedPlayers] = await Promise.all([
      prisma.serverEvent.count({
        where: { serverId, eventType: CHAT_EVENT_TYPE },
      }),
      prisma.serverEvent.count({
        where: {
          serverId,
          eventType: CHAT_EVENT_TYPE,
          detailsJson: { contains: '"flagged":true' },
        },
      }),
      prisma.serverEvent.count({
        where: {
          serverId,
          eventType: CHAT_EVENT_TYPE,
          detailsJson: { contains: '"source":"broadcast"' },
        },
      }),
      // Active mute flags set through the dashboard moderation queue.
      prisma.playerFlag.count({
        where: { serverId, muted: true },
      }),
    ]);
    return { messages, flagged, broadcasts, mutedPlayers };
  },

  /** Record a dashboard broadcast as a chat row once the agent confirms it. */
  async insertBroadcast(serverId: string, requestId: string, occurredAt: Date, message: string) {
    const summary = `[Server] ${message}`;
    return prisma.serverEvent.create({
      data: {
        serverId,
        eventType: CHAT_EVENT_TYPE,
        severity: 'info',
        occurredAt,
        summary,
        detailsJson: JSON.stringify({ source: 'broadcast', message: message.trim() }),
        requestId,
      },
    });
  },
};
