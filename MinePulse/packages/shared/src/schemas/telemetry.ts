import { z } from 'zod';
import { isoDateTime } from './common.js';

/**
 * Telemetry wire format sent by MinePulseAgent to the API.
 * Every request carries: serverId, timestamp, requestId (replay-resistant), sequence and schemaVersion.
 */

/** In-game coordinates of an online player (block granularity). */
export const playerPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type PlayerPosition = z.infer<typeof playerPositionSchema>;

export const onlinePlayerSchema = z.object({
  uuid: z.string().uuid(),
  username: z.string().min(1).max(32),
  // Live, read-only attributes. Optional so older agents stay compatible and so
  // the payload never carries anything more personal than the game itself.
  world: z.string().min(1).max(64).nullable().optional(),
  pingMs: z.number().int().nonnegative().max(100000).nullable().optional(),
  gamemode: z.string().max(32).nullable().optional(),
  operator: z.boolean().optional(),
  // Gameplay statistics reported for online players only. Never includes IPs,
  // chat, or anything outside the game world.
  position: playerPositionSchema.nullable().optional(),
  health: z.number().nonnegative().max(1024).nullable().optional(),
  foodLevel: z.number().int().nonnegative().max(100).nullable().optional(),
  xpLevel: z.number().int().nonnegative().nullable().optional(),
  mobKills: z.number().int().nonnegative().nullable().optional(),
  deaths: z.number().int().nonnegative().nullable().optional(),
  blocksMined: z.number().int().nonnegative().nullable().optional(),
  clientBrand: z.string().max(64).nullable().optional(),
});
export type OnlinePlayer = z.infer<typeof onlinePlayerSchema>;

/** One entry of the server's name ban list, reported with heartbeats. */
export const banEntrySchema = z.object({
  target: z.string().min(1).max(64),
  reason: z.string().max(500).nullable().optional(),
  source: z.string().max(128).nullable().optional(),
  expiresAt: isoDateTime.nullable().optional(),
});
export type BanEntry = z.infer<typeof banEntrySchema>;

/** One JVM garbage collector: cumulative work plus the most recent pause. */
export const gcCollectorSchema = z.object({
  name: z.string().min(1).max(128),
  count: z.number().int().nonnegative(),
  totalMs: z.number().nonnegative(),
  /** Duration of the most recent pause, when the JVM reported one. */
  lastMs: z.number().nonnegative().nullable().optional(),
});
export type GcCollector = z.infer<typeof gcCollectorSchema>;

/** One bucket of the sampled main-thread profile, i.e. a category of tick work. */
export const tickCategorySchema = z.object({
  name: z.string().min(1).max(64),
  samples: z.number().int().nonnegative(),
});
export type TickCategory = z.infer<typeof tickCategorySchema>;

/** How many profiler samples were observed inside a given plugin. */
export const pluginTickCostSchema = z.object({
  name: z.string().min(1).max(128),
  samples: z.number().int().nonnegative(),
});
export type PluginTickCost = z.infer<typeof pluginTickCostSchema>;

/**
 * Host/JVM facts that change rarely. Reported with heartbeats rather than every
 * metrics sample so the values are not duplicated across the whole series.
 */
export const hostSystemSchema = z.object({
  javaVersion: z.string().max(96).nullable().optional(),
  javaVendor: z.string().max(96).nullable().optional(),
  jvmArgs: z.array(z.string().max(256)).max(64).optional(),
  osName: z.string().max(128).nullable().optional(),
  osVersion: z.string().max(128).nullable().optional(),
  osArch: z.string().max(32).nullable().optional(),
  cpuCores: z.number().int().positive().nullable().optional(),
  diskTotalBytes: z.number().nonnegative().nullable().optional(),
  diskUsableBytes: z.number().nonnegative().nullable().optional(),
});
export type HostSystem = z.infer<typeof hostSystemSchema>;

const baseEnvelope = {
  schemaVersion: z.number().int().positive(),
  serverId: z.string().min(1).max(64),
  requestId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: isoDateTime,
};

/** Heartbeat + server identity + online player roster. */
export const heartbeatPayloadSchema = z.object({
  ...baseEnvelope,
  agentVersion: z.string().min(1).max(32),
  minecraftVersion: z.string().min(1).max(64),
  paperVersion: z.string().min(1).max(64),
  /**
   * Address players connect to, as the agent sees it ("host:port"). Optional so
   * older agents that do not report it stay compatible.
   */
  serverAddress: z.string().min(1).max(255).nullable().optional(),
  serverUptimeSeconds: z.number().nonnegative(),
  playerCount: z.number().int().nonnegative(),
  maxPlayers: z.number().int().positive(),
  players: z.array(onlinePlayerSchema).max(2000).default([]),
  /** Current name-ban list, so the dashboard can show real ban status. */
  bans: z.array(banEntrySchema).max(5000).optional(),
  /** Static host/JVM facts. Optional so older agents stay compatible. */
  system: hostSystemSchema.nullable().optional(),
});
export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;

/** A point-in-time metrics sample. */
export const metricsPayloadSchema = z.object({
  ...baseEnvelope,
  tps1m: z.number().min(0).max(20).nullable().optional(),
  tps5m: z.number().min(0).max(20).nullable().optional(),
  tps15m: z.number().min(0).max(20).nullable().optional(),
  mspt: z.number().nonnegative().max(100000).nullable().optional(),
  heapUsedBytes: z.number().nonnegative(),
  heapMaxBytes: z.number().nonnegative(),
  heapCommittedBytes: z.number().nonnegative(),
  cpuUsagePercent: z.number().min(0).max(100).nullable().optional(),
  // --- Performance detail (optional; older agents simply omit them) ---
  /** Per-collector JVM garbage collection counters. */
  gc: z.array(gcCollectorSchema).max(16).nullable().optional(),
  /** Committed-but-not-heap memory (metaspace, code cache, ...). */
  nonHeapUsedBytes: z.number().nonnegative().nullable().optional(),
  /** The "Metaspace" pool specifically, when present. */
  metaspaceUsedBytes: z.number().nonnegative().nullable().optional(),
  /** Old generation heap (G1 Old Gen / Tenured), when identifiable. */
  heapOldBytes: z.number().nonnegative().nullable().optional(),
  /** Young generation heap (Eden + Survivor), when identifiable. */
  heapYoungBytes: z.number().nonnegative().nullable().optional(),
  /** Direct NIO buffer pool usage. */
  directBufferBytes: z.number().nonnegative().nullable().optional(),
  threadCount: z.number().int().nonnegative().nullable().optional(),
  daemonThreadCount: z.number().int().nonnegative().nullable().optional(),
  /** Total loaded entities across all worlds. */
  entityCount: z.number().int().nonnegative().nullable().optional(),
  /** Total loaded chunks across all worlds. */
  chunkCount: z.number().int().nonnegative().nullable().optional(),
  // --- Sampling profiler (optional; older agents simply omit them) ---
  /** Sampled main-thread categories, e.g. World ticking / Entities / Plugins. */
  tickBreakdown: z.array(tickCategorySchema).max(24).nullable().optional(),
  /** Sampled per-plugin tick cost. */
  pluginTickCost: z.array(pluginTickCostSchema).max(200).nullable().optional(),
  /** Cumulative host network counters (bytes since boot), differenced into rates. */
  netRxBytes: z.number().nonnegative().nullable().optional(),
  netTxBytes: z.number().nonnegative().nullable().optional(),
});
export type MetricsPayload = z.infer<typeof metricsPayloadSchema>;

/** Plugin inventory snapshot (sent on its own, slower interval). */
export const pluginRecordSchema = z.object({
  name: z.string().min(1).max(128),
  version: z.string().max(64).default('unknown'),
  enabled: z.boolean().default(true),
  staged: z.enum(['enable', 'disable']).nullable().optional(),
  apiVersion: z.string().max(32).nullable().optional(),
  author: z.string().max(128).nullable().optional(),
  commandCount: z.number().int().nonnegative().nullable().optional(),
});
export type PluginRecordInput = z.infer<typeof pluginRecordSchema>;

export const pluginsPayloadSchema = z.object({
  schemaVersion: z.number().int().positive(),
  serverId: z.string().min(1).max(64),
  requestId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: isoDateTime,
  collectedAt: isoDateTime,
  inventoryHash: z.string().min(1).max(128),
  plugins: z.array(pluginRecordSchema).max(2000),
});
export type PluginsPayload = z.infer<typeof pluginsPayloadSchema>;

/** Structured monitoring events. */
export const serverEventInputSchema = z.object({
  type: z.enum([
    'server_started',
    'server_stopped',
    'agent_connected',
    'agent_disconnected',
    'heartbeat_missed',
    'heartbeat_restored',
    'player_joined',
    'player_left',
    'player_death',
    'chat_message',
    'plugins_changed',
    'performance_warning',
    'performance_resolved',
    'memory_threshold_exceeded',
    'alert_delivered',
    'alert_delivery_failed',
    'setting_changed',
  ]),
  severity: z.enum(['info', 'warning', 'critical']),
  occurredAt: isoDateTime,
  summary: z.string().min(1).max(500),
  details: z.record(z.unknown()).optional(),
});
export type ServerEventInput = z.infer<typeof serverEventInputSchema>;

export const eventsPayloadSchema = z.object({
  schemaVersion: z.number().int().positive(),
  serverId: z.string().min(1).max(64),
  requestId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: isoDateTime,
  events: z.array(serverEventInputSchema).min(1).max(100),
});
export type EventsPayload = z.infer<typeof eventsPayloadSchema>;

/** Generic ack returned for accepted telemetry. */
export const telemetryAckSchema = z.object({
  accepted: z.boolean(),
  receivedAt: isoDateTime,
  serverState: z.enum(['online', 'degraded', 'stale', 'offline']),
  duplicate: z.boolean().optional(),
});
export type TelemetryAck = z.infer<typeof telemetryAckSchema>;

/**
 * Response to GET /agent/context: lets an agent discover which server its
 * credential belongs to, so it never needs the serverId hardcoded.
 */
export const agentContextResponseSchema = z.object({
  schemaVersion: z.number().int().positive(),
  serverId: z.string(),
  serverName: z.string(),
  serverState: z.enum(['online', 'degraded', 'stale', 'offline']),
  heartbeatStaleSeconds: z.number().int().nonnegative(),
  heartbeatOfflineSeconds: z.number().int().nonnegative(),
});
export type AgentContextResponse = z.infer<typeof agentContextResponseSchema>;

/* ------------------------------------------------------------------------- *
 * Moderation channel (dashboard -> API -> agent)
 *
 * The agent has no inbound port, so the API queues typed, whitelisted actions
 * and the agent polls for them. Actions are fixed verbs, never arbitrary
 * commands: the agent maps each one onto a specific Paper API call.
 * ------------------------------------------------------------------------- */

/** The action verbs the agent is able to execute (mute is a synced flag). */
export const agentActionTypeSchema = z.enum([
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
  'give',
  'restore_death',
  'console',
  'plugin_enable',
  'plugin_disable',
  'plugin_reload',
]);
export type AgentActionType = z.infer<typeof agentActionTypeSchema>;

/** One queued action returned to the agent. */
export const agentActionSchema = z.object({
  id: z.string().min(1).max(64),
  action: agentActionTypeSchema,
  targetUuid: z.string().nullable().optional(),
  targetName: z.string().nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  mode: z.string().max(32).nullable().optional(),
  text: z.string().max(500).nullable().optional(),
  /** Installed plugin name for the plugin lifecycle verbs. */
  plugin: z.string().max(128).nullable().optional(),
  /** Fixed console command id for the `console` verb. */
  cmd: z.string().max(32).nullable().optional(),
  /** Material id and count for the `give` verb. */
  item: z.string().max(256).nullable().optional(),
  amount: z.number().int().nullable().optional(),
  /**
   * Item bundles for the `restore_death` verb: either a vanilla material id
   * (`name` + `amount`) or a Bukkit-serialized stack bundle (`nbt`, base64)
   * which restores enchantments, damage and custom names exactly.
   */
  items: z
    .array(
      z.object({
        name: z.string().max(512).optional(),
        amount: z.number().int().min(1).max(2304).optional(),
        /** Bukkit `ItemStack.serializeItemsAsBytes` output, base64. */
        nbt: z.string().max(600_000).optional(),
      }),
    )
    .max(64)
    .nullable()
    .optional(),
});
export type AgentAction = z.infer<typeof agentActionSchema>;

/** Response to GET /agent/actions: pending work plus the current mute list. */
export const agentActionsResponseSchema = z.object({
  schemaVersion: z.number().int().positive(),
  serverId: z.string(),
  actions: z.array(agentActionSchema).max(200).default([]),
  mutedUuids: z.array(z.string().uuid()).max(10000).default([]),
});
export type AgentActionsResponse = z.infer<typeof agentActionsResponseSchema>;

/** Body the agent posts back once an action has run. */
export const agentActionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().max(500).nullable().optional(),
});
export type AgentActionResult = z.infer<typeof agentActionResultSchema>;
