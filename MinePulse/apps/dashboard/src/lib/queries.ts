import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  AlertIncident,
  AlertsOverview,
  CurrentMetrics,
  MetricHistory,
  Paginated,
  PlayerSummary,
  PlayerSession,
  PluginSnapshot,
  ServerEvent,
  ServerInfo,
  ServerStatus,
  PlayerActivity,
  Settings,
} from '@minepulse/shared';
import { api, buildQuery } from './api';

export const qk = {
  server: ['server'] as const,
  status: ['status'] as const,
  metricsCurrent: ['metrics', 'current'] as const,
  metricsHistory: (range: string) => ['metrics', 'history', range] as const,
  events: (params: Record<string, unknown>) => ['events', params] as const,
  eventsRecent: (limit: number) => ['events', 'recent', limit] as const,
  plugins: ['plugins'] as const,
  players: (params: Record<string, unknown>) => ['players', params] as const,
  playersOnline: ['players', 'online'] as const,
  player: (uuid: string) => ['players', uuid] as const,
  playerSessions: (uuid: string, page: number) => ['players', uuid, 'sessions', page] as const,
  activity: (days: number) => ['activity', days] as const,
  alerts: ['alerts'] as const,
  alertIncidents: (ruleId: string) => ['alerts', ruleId, 'incidents'] as const,
  settings: ['settings'] as const,
};

export function useServerInfo(): UseQueryResult<ServerInfo> {
  return useQuery({ queryKey: qk.server, queryFn: () => api.get<ServerInfo>('/server') });
}

export function useServerStatus(): UseQueryResult<ServerStatus> {
  return useQuery({
    queryKey: qk.status,
    queryFn: () => api.get<ServerStatus>('/server/status'),
    refetchInterval: 15000,
  });
}

export function useCurrentMetrics(): UseQueryResult<CurrentMetrics> {
  return useQuery({
    queryKey: qk.metricsCurrent,
    queryFn: () => api.get<CurrentMetrics>('/server/metrics/current'),
    refetchInterval: 10000,
  });
}

export function useMetricHistory(range: string): UseQueryResult<MetricHistory> {
  return useQuery({
    queryKey: qk.metricsHistory(range),
    queryFn: () => api.get<MetricHistory>(`/server/metrics/history${buildQuery({ range })}`),
    refetchInterval: 30000,
  });
}

export function useEvents(params: {
  page?: number;
  pageSize?: number;
  severity?: string;
  category?: string;
  search?: string;
  from?: string;
  to?: string;
}): UseQueryResult<Paginated<ServerEvent>> {
  return useQuery({
    queryKey: qk.events(params),
    queryFn: () => api.get<Paginated<ServerEvent>>(`/server/events${buildQuery(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function useRecentEvents(limit = 8): UseQueryResult<ServerEvent[]> {
  return useQuery({
    queryKey: qk.eventsRecent(limit),
    queryFn: () => api.get<ServerEvent[]>(`/server/events/recent${buildQuery({ limit })}`),
    refetchInterval: 20000,
  });
}

export function usePlugins(): UseQueryResult<PluginSnapshot | null> {
  return useQuery({
    queryKey: qk.plugins,
    queryFn: () => api.get<PluginSnapshot | null>('/server/plugins'),
    refetchInterval: 60000,
  });
}

export function useOnlinePlayers(): UseQueryResult<Paginated<PlayerSummary>> {
  return useQuery({
    queryKey: qk.playersOnline,
    queryFn: () =>
      api.get<Paginated<PlayerSummary>>(`/server/players${buildQuery({ onlineOnly: true, pageSize: 100 })}`),
    refetchInterval: 20000,
  });
}

export function usePlayers(params: {
  page: number;
  pageSize: number;
  search?: string;
}): UseQueryResult<Paginated<PlayerSummary>> {
  return useQuery({
    queryKey: qk.players(params),
    queryFn: () => api.get<Paginated<PlayerSummary>>(`/server/players${buildQuery(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function usePlayer(uuid: string | null): UseQueryResult<PlayerSummary> {
  return useQuery({
    queryKey: qk.player(uuid ?? ''),
    queryFn: () => api.get<PlayerSummary>(`/server/players/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function usePlayerSessions(
  uuid: string | null,
  page: number,
): UseQueryResult<Paginated<PlayerSession>> {
  return useQuery({
    queryKey: qk.playerSessions(uuid ?? '', page),
    queryFn: () =>
      api.get<Paginated<PlayerSession>>(`/server/players/${uuid}/sessions${buildQuery({ page, pageSize: 25 })}`),
    enabled: Boolean(uuid),
    placeholderData: (prev) => prev,
  });
}

export function useActivity(days = 14): UseQueryResult<PlayerActivity> {
  return useQuery({
    queryKey: qk.activity(days),
    queryFn: () => api.get<PlayerActivity>(`/server/activity${buildQuery({ days })}`),
  });
}

export function useAlerts(): UseQueryResult<AlertsOverview> {
  return useQuery({
    queryKey: qk.alerts,
    queryFn: () => api.get<AlertsOverview>('/alerts'),
    refetchInterval: 30000,
  });
}

export function useAlertIncidents(ruleId: string | null): UseQueryResult<AlertIncident[]> {
  return useQuery({
    queryKey: qk.alertIncidents(ruleId ?? ''),
    queryFn: () =>
      api.get<AlertIncident[]>(`/alerts/${ruleId}/incidents${buildQuery({ limit: 50 })}`),
    enabled: Boolean(ruleId),
  });
}

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<Settings>('/settings'),
  });
}

/** Save settings and refresh anything that depends on heartbeat thresholds. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, number>) =>
      api.patch<Settings>('/settings', patch),
    onSuccess: (settings) => {
      queryClient.setQueryData(qk.settings, settings);
      void queryClient.invalidateQueries({ queryKey: qk.status });
    },
  });
}
