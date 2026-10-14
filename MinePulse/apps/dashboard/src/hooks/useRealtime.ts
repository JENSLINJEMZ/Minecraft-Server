import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AlertIncident,
  AlertRule,
  CurrentMetrics,
  PluginSnapshot,
  ServerStatus,
} from '@minepulse/shared';
import { SOCKET_EVENTS } from '@minepulse/shared';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../components/ui/Toast';
import { qk } from '../lib/queries';

interface PlayersPayload {
  serverId: string;
  online: unknown[];
  onlineCount: number;
}

/**
 * Subscribe to realtime Socket.IO events and push them straight into the
 * React Query cache so every page updates live without extra polling.
 */
export function useRealtime(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!socket) return;

    const onStatus = (status: ServerStatus) => {
      queryClient.setQueryData(qk.status, status);
    };

    const onMetrics = (metrics: CurrentMetrics) => {
      queryClient.setQueryData(qk.metricsCurrent, metrics);
      // Keep the 15m live chart moving.
      void queryClient.invalidateQueries({ queryKey: qk.metricsHistory('15m') });
      void queryClient.invalidateQueries({ queryKey: qk.metricsHistory('1h') });
    };

    const onPlayers = (payload: PlayersPayload) => {
      queryClient.setQueryData(qk.playersOnline, (prev: unknown) => {
        if (prev && typeof prev === 'object') {
          return { ...(prev as object), items: payload.online, total: payload.online.length };
        }
        return prev;
      });
      void queryClient.invalidateQueries({ queryKey: ['players'] });
    };

    const onPlugins = (snapshot: PluginSnapshot) => {
      queryClient.setQueryData(qk.plugins, snapshot);
    };

    const onEvent = () => {
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    };

    const onAlertTriggered = (payload: { rule: AlertRule; incident: AlertIncident }) => {
      void queryClient.invalidateQueries({ queryKey: qk.alerts });
      toast.error(
        `Alert: ${payload.rule.name}`,
        payload.incident.summary ?? `${payload.rule.metric} ${payload.rule.operator} ${payload.rule.threshold}`,
      );
    };

    const onAlertResolved = (payload: { rule: AlertRule; incident: AlertIncident }) => {
      void queryClient.invalidateQueries({ queryKey: qk.alerts });
      toast.success(`Resolved: ${payload.rule.name}`, payload.incident.summary ?? undefined);
    };

    socket.on(SOCKET_EVENTS.serverStatus, onStatus);
    socket.on(SOCKET_EVENTS.serverMetrics, onMetrics);
    socket.on(SOCKET_EVENTS.serverPlayers, onPlayers);
    socket.on(SOCKET_EVENTS.serverPlugins, onPlugins);
    socket.on(SOCKET_EVENTS.serverEvent, onEvent);
    socket.on(SOCKET_EVENTS.alertTriggered, onAlertTriggered);
    socket.on(SOCKET_EVENTS.alertResolved, onAlertResolved);

    return () => {
      socket.off(SOCKET_EVENTS.serverStatus, onStatus);
      socket.off(SOCKET_EVENTS.serverMetrics, onMetrics);
      socket.off(SOCKET_EVENTS.serverPlayers, onPlayers);
      socket.off(SOCKET_EVENTS.serverPlugins, onPlugins);
      socket.off(SOCKET_EVENTS.serverEvent, onEvent);
      socket.off(SOCKET_EVENTS.alertTriggered, onAlertTriggered);
      socket.off(SOCKET_EVENTS.alertResolved, onAlertResolved);
    };
  }, [socket, queryClient, toast]);
}
