import type { Server as DbServer, ServerHeartbeat as DbServerHeartbeat } from '@prisma/client';
import type { ServerStatus } from '@minepulse/shared';
import { heartbeatRepository } from '../repositories/heartbeatRepository.js';
import { metricRepository } from '../repositories/metricRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { toServerStatus } from './dto.js';

const HEALTHY_TPS_MIN = 18;
const HEALTHY_MSPT_MAX = 55;

export interface ResolvedStatus {
  dto: ServerStatus;
  state: ServerStatus['state'];
  heartbeat: DbServerHeartbeat | null;
}

/**
 * Derive the current connection/health state from the newest heartbeat and
 * metric sample, using configurable timeouts from ServerSettings.
 *
 *  - offline  : no heartbeat, or last heartbeat older than heartbeatOfflineSeconds
 *  - stale    : heartbeat older than heartbeatStaleSeconds (agent may have died)
 *  - degraded : recently reporting but TPS/MSPT are unhealthy
 *  - online   : recently reporting and healthy
 */
export async function resolveStatus(server: DbServer): Promise<ResolvedStatus> {
  const settings = await settingsRepository.get(server.id);
  const [heartbeat, latestMetric] = await Promise.all([
    heartbeatRepository.latest(server.id),
    metricRepository.latest(server.id),
  ]);

  const now = Date.now();
  const hbAgeSeconds = heartbeat ? (now - heartbeat.receivedAt.getTime()) / 1000 : null;
  const metricAgeSeconds = latestMetric ? (now - latestMetric.recordedAt.getTime()) / 1000 : null;

  const freshnessCandidates = [hbAgeSeconds, metricAgeSeconds].filter(
    (v): v is number => v !== null,
  );
  const dataFreshnessSeconds =
    freshnessCandidates.length > 0 ? Math.round(Math.min(...freshnessCandidates)) : null;

  let state: ServerStatus['state'];
  let reason: string | null = null;

  if (!heartbeat || hbAgeSeconds === null) {
    state = 'offline';
    reason = 'No heartbeat received yet';
  } else if (hbAgeSeconds > settings.heartbeatOfflineSeconds) {
    state = 'offline';
    reason = `No heartbeat for ${Math.round(hbAgeSeconds)}s`;
  } else if (hbAgeSeconds > settings.heartbeatStaleSeconds) {
    state = 'stale';
    reason = `Heartbeat delayed ${Math.round(hbAgeSeconds)}s`;
  } else if (
    latestMetric &&
    ((latestMetric.tps1m !== null && latestMetric.tps1m < HEALTHY_TPS_MIN) ||
      (latestMetric.mspt !== null && latestMetric.mspt > HEALTHY_MSPT_MAX))
  ) {
    state = 'degraded';
    reason = 'TPS/MSPT below healthy thresholds';
  } else {
    state = 'online';
  }

  const agentConnected =
    hbAgeSeconds !== null && hbAgeSeconds <= settings.heartbeatStaleSeconds;

  const dto = toServerStatus(server, heartbeat, state, reason, dataFreshnessSeconds, agentConnected);
  return { dto, state, heartbeat };
}
