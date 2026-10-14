/**
 * Shared constants for the MinePulse platform.
 * These values are part of the agent <-> API contract and the socket contract.
 */

/** Version of the telemetry payload schema (bump when the wire format changes). */
export const SCHEMA_VERSION = 1 as const;

/** Socket.IO event names (validated on both ends). */
export const SOCKET_EVENTS = {
  serverStatus: 'server:status',
  serverMetrics: 'server:metrics',
  serverPlayers: 'server:players',
  serverPlugins: 'server:plugins',
  serverEvent: 'server:event',
  alertTriggered: 'alert:triggered',
  alertResolved: 'alert:resolved',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Derived connection state of a monitored server. */
export const SERVER_STATES = ['online', 'degraded', 'stale', 'offline'] as const;
export const SERVER_STATE = {
  online: 'online',
  degraded: 'degraded',
  stale: 'stale',
  offline: 'offline',
} as const;

/** Event severities used across events, alerts and incidents. */
export const SEVERITIES = ['info', 'warning', 'critical'] as const;

/** Categories of structured monitoring events. */
export const EVENT_CATEGORIES = [
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
] as const;

/** Metrics an alert rule can be evaluated against. */
export const ALERT_METRICS = [
  'heartbeat_missing',
  'agent_disconnected',
  'tps',
  'mspt',
  'heap_percent',
  'player_count',
  'repeated_incidents',
] as const;

/** Comparison operators for alert rules. */
export const ALERT_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;

/** Chart time ranges offered in the UI. */
export const METRIC_RANGES = ['15m', '1h', '6h', '24h', '7d'] as const;

/** Default heartbeat timeouts (seconds). Overridable via env/settings. */
export const DEFAULT_HEARTBEAT_STALE_SECONDS = 30;
export const DEFAULT_HEARTBEAT_OFFLINE_SECONDS = 60;

/** Length of a Minecraft tick in milliseconds (20 TPS). */
export const MS_PER_TICK = 50;

/** Dashboard user roles. */
export const USER_ROLES = ['admin', 'viewer'] as const;

export const ROLE = {
  admin: 'admin',
  viewer: 'viewer',
} as const;
