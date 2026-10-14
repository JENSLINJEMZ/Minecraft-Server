import { z } from 'zod';
import { isoDateTime } from './common.js';

/**
 * Telemetry wire format sent by MinePulseAgent to the API.
 * Every request carries: serverId, timestamp, requestId (replay-resistant), sequence and schemaVersion.
 */

export const onlinePlayerSchema = z.object({
  uuid: z.string().uuid(),
  username: z.string().min(1).max(32),
});
export type OnlinePlayer = z.infer<typeof onlinePlayerSchema>;

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
});
export type MetricsPayload = z.infer<typeof metricsPayloadSchema>;

/** Plugin inventory snapshot (sent on its own, slower interval). */
export const pluginRecordSchema = z.object({
  name: z.string().min(1).max(128),
  version: z.string().max(64).default('unknown'),
  enabled: z.boolean().default(true),
  apiVersion: z.string().max(32).nullable().optional(),
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
