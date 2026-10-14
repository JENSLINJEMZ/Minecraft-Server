import { EventEmitter } from 'node:events';
import type {
  AlertIncident,
  AlertRule,
  CurrentMetrics,
  PlayerSummary,
  PluginSnapshot,
  ServerEvent,
  ServerStatus,
} from '@minepulse/shared';

/**
 * In-process publish/subscribe hub. Telemetry ingestion publishes here after
 * data is persisted; the Socket.IO layer subscribes and fans out to clients.
 * This keeps persistence and realtime concerns decoupled (no cycles).
 */
export interface RealtimeEvents {
  status: (status: ServerStatus) => void;
  metrics: (metrics: CurrentMetrics) => void;
  players: (payload: { serverId: string; online: PlayerSummary[]; onlineCount: number }) => void;
  plugins: (snapshot: PluginSnapshot) => void;
  event: (event: ServerEvent) => void;
  'alert:triggered': (payload: { rule: AlertRule; incident: AlertIncident }) => void;
  'alert:resolved': (payload: { rule: AlertRule; incident: AlertIncident }) => void;
}

class TypedBus extends EventEmitter {
  publish<K extends keyof RealtimeEvents>(
    event: K,
    ...args: Parameters<RealtimeEvents[K]>
  ): void {
    this.emit(event, ...args);
  }

  subscribe<K extends keyof RealtimeEvents>(event: K, listener: RealtimeEvents[K]): void {
    this.on(event, listener as (...args: unknown[]) => void);
  }
}

export const bus = new TypedBus();
bus.setMaxListeners(50);
