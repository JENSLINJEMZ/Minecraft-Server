import type {
  AlertRule as DbAlertRule,
  AlertIncident as DbAlertIncident,
  MetricAggregate1h,
  MetricAggregate1m,
  MetricSample as DbMetricSample,
  Player as DbPlayer,
  PlayerSession as DbPlayerSession,
  PluginRecord as DbPluginRecord,
  PluginSnapshot as DbPluginSnapshot,
  Server as DbServer,
  ServerEvent as DbServerEvent,
  ServerHeartbeat as DbServerHeartbeat,
  ServerSettings as DbServerSettings,
  User as DbUser,
} from '@prisma/client';
import type {
  AlertIncident,
  AlertIncidentView,
  AlertRule,
  CurrentMetrics,
  HeartbeatPayload,
  MetricPoint,
  MetricSample,
  PlayerSession,
  PlayerSummary,
  PluginSnapshot,
  PluginView,
  ServerEvent,
  ServerInfo,
  ServerStatus,
  SessionUser,
  Settings,
} from '@minepulse/shared';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const isoReq = (d: Date): string => d.toISOString();
const bigToNum = (v: bigint | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export function toServerInfo(server: DbServer): ServerInfo {
  return {
    id: server.id,
    name: server.name,
    minecraftVersion: server.minecraftVersion,
    software: server.software,
    address: server.address,
    createdAt: isoReq(server.createdAt),
    updatedAt: isoReq(server.updatedAt),
  };
}

export function toSessionUser(user: DbUser): SessionUser {
  return { id: user.id, email: user.email, role: user.role === 'admin' ? 'admin' : 'viewer' };
}

export function toServerStatus(
  server: DbServer,
  heartbeats: DbServerHeartbeat | null,
  state: ServerStatus['state'],
  reason: string | null,
  dataFreshnessSeconds: number | null,
  agentConnected: boolean,
): ServerStatus {
  const hb = heartbeats;
  return {
    serverId: server.id,
    state,
    agentConnected,
    minecraftVersion: hb?.minecraftVersion ?? server.minecraftVersion ?? null,
    software: hb?.paperVersion ? `Paper ${hb.paperVersion}` : (server.software ?? null),
    playerCount: hb?.playerCount ?? null,
    maxPlayers: hb?.maxPlayers ?? null,
    uptimeSeconds: hb?.serverUptimeSeconds ?? null,
    lastHeartbeatAt: iso(hb?.receivedAt ?? null),
    lastTelemetryAt: iso(hb?.receivedAt ?? null),
    dataFreshnessSeconds,
    reason,
  };
}

export function toMetricSample(row: DbMetricSample): MetricSample {
  return {
    recordedAt: isoReq(row.recordedAt),
    tps1m: row.tps1m,
    tps5m: row.tps5m,
    tps15m: row.tps15m,
    mspt: row.mspt,
    heapUsedBytes: bigToNum(row.heapUsedBytes),
    heapMaxBytes: bigToNum(row.heapMaxBytes),
    heapCommittedBytes: bigToNum(row.heapCommittedBytes),
    cpuUsagePercent: row.cpuUsagePercent,
  };
}

export function toCurrentMetrics(
  server: DbServer,
  heartbeats: DbServerHeartbeat | null,
  sample: DbMetricSample | null,
): CurrentMetrics {
  const heapUsed = bigToNum(sample?.heapUsedBytes ?? null);
  const heapMax = bigToNum(sample?.heapMaxBytes ?? null);
  return {
    serverId: server.id,
    sample: sample ? toMetricSample(sample) : null,
    heapUsedPercent: heapUsed !== null && heapMax ? Math.round((heapUsed / heapMax) * 1000) / 10 : null,
    playerCount: heartbeats?.playerCount ?? null,
    maxPlayers: heartbeats?.maxPlayers ?? null,
    uptimeSeconds: heartbeats?.serverUptimeSeconds ?? null,
    agentVersion: heartbeats?.agentVersion ?? null,
    lastHeartbeatAt: iso(heartbeats?.receivedAt ?? null),
  };
}

export function metricPointFromRaw(row: DbMetricSample): MetricPoint {
  return {
    recordedAt: isoReq(row.recordedAt),
    tps1m: row.tps1m,
    tps5m: row.tps5m,
    tps15m: row.tps15m,
    mspt: row.mspt,
    heapUsedBytes: bigToNum(row.heapUsedBytes),
    heapMaxBytes: bigToNum(row.heapMaxBytes),
    playerCount: null,
    cpuUsagePercent: row.cpuUsagePercent,
  };
}

export function metricPointFromAgg1m(row: MetricAggregate1m): MetricPoint {
  return {
    recordedAt: isoReq(row.bucketStart),
    tps1m: row.tps1mAvg,
    tps5m: row.tps5mAvg,
    tps15m: row.tps15mAvg,
    mspt: row.msptAvg,
    heapUsedBytes: row.heapUsedAvg,
    heapMaxBytes: row.heapMaxAvg,
    playerCount: row.playerCountAvg !== null ? Math.round(row.playerCountAvg) : null,
    cpuUsagePercent: row.cpuAvg,
  };
}

export function metricPointFromAgg1h(row: MetricAggregate1h): MetricPoint {
  return {
    recordedAt: isoReq(row.bucketStart),
    tps1m: row.tps1mAvg,
    tps5m: row.tps5mAvg,
    tps15m: row.tps15mAvg,
    mspt: row.msptAvg,
    heapUsedBytes: row.heapUsedAvg,
    heapMaxBytes: row.heapMaxAvg,
    playerCount: row.playerCountAvg !== null ? Math.round(row.playerCountAvg) : null,
    cpuUsagePercent: row.cpuAvg,
  };
}

export function toPlayerSummary(
  player: DbPlayer,
  online: boolean,
  currentSessionStartedAt: Date | null,
  stats: { totalPlaytimeSeconds: number; sessionCount: number },
): PlayerSummary {
  return {
    uuid: player.uuid,
    lastKnownUsername: player.lastKnownUsername,
    firstSeenAt: iso(player.firstSeenAt),
    lastSeenAt: iso(player.lastSeenAt),
    online,
    currentSessionStartedAt: iso(currentSessionStartedAt),
    totalPlaytimeSeconds: stats.totalPlaytimeSeconds,
    sessionCount: stats.sessionCount,
  };
}

export function toPlayerSession(row: DbPlayerSession): PlayerSession {
  return {
    id: row.id,
    playerUuid: row.playerUuid,
    usernameAtJoin: row.usernameAtJoin,
    joinedAt: isoReq(row.joinedAt),
    leftAt: iso(row.leftAt),
    durationSeconds: row.durationSeconds,
  };
}

export function toPluginView(row: DbPluginRecord): PluginView {
  return {
    pluginName: row.pluginName,
    version: row.version,
    enabled: row.enabled,
    apiVersion: row.apiVersion,
  };
}

export function toPluginSnapshot(row: DbPluginSnapshot & { records: DbPluginRecord[] }): PluginSnapshot {
  return {
    id: row.id,
    serverId: row.serverId,
    collectedAt: isoReq(row.collectedAt),
    pluginCount: row.pluginCount,
    inventoryHash: row.inventoryHash,
    plugins: row.records.map(toPluginView),
  };
}

function parseDetails(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function toServerEvent(row: DbServerEvent): ServerEvent {
  return {
    id: row.id,
    serverId: row.serverId,
    eventType: row.eventType,
    severity: (row.severity as ServerEvent['severity']) ?? 'info',
    occurredAt: isoReq(row.occurredAt),
    receivedAt: isoReq(row.receivedAt),
    summary: row.summary,
    details: parseDetails(row.detailsJson),
    requestId: row.requestId,
  };
}

export function toAlertRule(row: DbAlertRule): AlertRule {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    metric: row.metric as AlertRule['metric'],
    operator: row.operator as AlertRule['operator'],
    threshold: row.threshold,
    evaluationWindowSeconds: row.evaluationWindowSeconds,
    severity: (row.severity as AlertRule['severity']) ?? 'warning',
    cooldownSeconds: row.cooldownSeconds,
    enabled: row.enabled,
    lastTriggeredAt: iso(row.lastTriggeredAt),
    lastDeliveryStatus: (row.lastDeliveryStatus as AlertRule['lastDeliveryStatus']) ?? 'none',
    createdAt: isoReq(row.createdAt),
    updatedAt: isoReq(row.updatedAt),
  };
}

export function toAlertIncident(row: DbAlertIncident): AlertIncident {
  return {
    id: row.id,
    alertRuleId: row.alertRuleId,
    startedAt: isoReq(row.startedAt),
    resolvedAt: iso(row.resolvedAt),
    lastNotifiedAt: iso(row.lastNotifiedAt),
    status: row.status === 'open' ? 'open' : 'resolved',
    triggerValue: row.triggerValue,
    summary: row.summary,
  };
}

export function toAlertIncidentView(
  row: DbAlertIncident & { alertRule: DbAlertRule },
): AlertIncidentView {
  return {
    ...toAlertIncident(row),
    ruleName: row.alertRule.name,
    ruleMetric: row.alertRule.metric as AlertIncidentView['ruleMetric'],
    ruleSeverity: (row.alertRule.severity as AlertIncidentView['ruleSeverity']) ?? 'warning',
  };
}

export function toSettings(row: DbServerSettings, discordConfigured: boolean): Settings {
  return {
    retentionRawMetricsDays: row.retentionRawMetricsDays,
    retentionAggregated1mDays: row.retentionAggregated1mDays,
    retentionAggregated1hDays: row.retentionAggregated1hDays,
    retentionEventsDays: row.retentionEventsDays,
    retentionPlayerSessionsDays: row.retentionPlayerSessionsDays,
    heartbeatStaleSeconds: row.heartbeatStaleSeconds,
    heartbeatOfflineSeconds: row.heartbeatOfflineSeconds,
    discordConfigured,
  };
}

export type { HeartbeatPayload };
