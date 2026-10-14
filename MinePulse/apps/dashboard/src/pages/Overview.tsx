import { useState } from 'react';
import { Copy, Gauge, HardDrive, Users, Activity, Clock, Plug, Server } from 'lucide-react';
import {
  useCurrentMetrics,
  useMetricHistory,
  useOnlinePlayers,
  usePlugins,
  useRecentEvents,
  useServerInfo,
  useServerStatus,
} from '../lib/queries';
import { MetricCard } from '../components/metrics/MetricCard';
import { MetricChart } from '../components/charts/MetricChart';
import { StatusPill } from '../components/ui/StatusPill';
import { RangeSelector } from '../components/common/RangeSelector';
import { EventList } from '../components/events/EventList';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from '../components/ui/primitives';
import { useToast } from '../components/ui/Toast';
import { ApiError } from '../lib/api';
import {
  formatAgo,
  formatBytes,
  formatDuration,
  formatMspt,
  formatNumber,
  formatPercent,
  formatTps,
} from '../lib/format';

function tpsTone(tps: number | null): 'good' | 'warn' | 'bad' | 'default' {
  if (tps === null) return 'default';
  if (tps < 15) return 'bad';
  if (tps < 18) return 'warn';
  return 'good';
}

function msptTone(mspt: number | null): 'good' | 'warn' | 'bad' | 'default' {
  if (mspt === null) return 'default';
  if (mspt > 55) return 'bad';
  if (mspt > 45) return 'warn';
  return 'good';
}

function heapTone(pct: number | null): 'good' | 'warn' | 'bad' | 'default' {
  if (pct === null) return 'default';
  if (pct > 90) return 'bad';
  if (pct > 75) return 'warn';
  return 'good';
}

export function OverviewPage(): JSX.Element {
  const [range, setRange] = useState('1h');
  const toast = useToast();

  const info = useServerInfo();
  const status = useServerStatus();
  const metrics = useCurrentMetrics();
  const history = useMetricHistory(range);
  const events = useRecentEvents(7);
  const online = useOnlinePlayers();
  const plugins = usePlugins();

  const s = status.data;
  const m = metrics.data;
  const sample = m?.sample ?? null;

  async function copyAddress(): Promise<void> {
    const addr = info.data?.address;
    if (!addr) {
      toast.info('No address configured', 'Set an address in Settings to enable copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(addr);
      toast.success('Address copied', addr);
    } catch {
      toast.error('Could not copy', 'Clipboard access was denied by the browser.');
    }
  }

  if (status.isError && info.isError) {
    const unauthorized =
      (status.error instanceof ApiError && status.error.status === 401) ||
      (info.error instanceof ApiError && info.error.status === 401);
    return (
      <ErrorState
        message={
          unauthorized
            ? 'Your session is not authorized. Please sign out and sign in again.'
            : 'The API could not be reached. Is the MinePulse API running on port 4000?'
        }
        onRetry={() => void status.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent-hover">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-content">
                  {info.data?.name ?? 'Minecraft Server'}
                </h2>
                {s ? <StatusPill state={s.state} /> : <Skeleton className="h-5 w-16" />}
              </div>
              <p className="mt-1 text-xs text-content-muted">
                {s?.software ?? 'Paper'}
                {s?.minecraftVersion ? ` · MC ${s.minecraftVersion}` : ''}
              </p>
              {s?.reason ? (
                <p className="mt-1 text-xs text-severity-warning">{s.reason}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button type="button" className="btn-outline text-xs" onClick={() => void copyAddress()}>
              <Copy className="h-3.5 w-3.5" />
              {info.data?.address ?? 'No address'}
            </button>
            <p className="text-xs text-content-faint">
              Last telemetry: {formatAgo(s?.lastTelemetryAt)}
              {s?.dataFreshnessSeconds !== null && s?.dataFreshnessSeconds !== undefined
                ? ` (${s.dataFreshnessSeconds}s)`
                : ''}
            </p>
          </div>
        </div>
      </Card>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Players"
          icon={<Users className="h-4 w-4" />}
          value={s?.playerCount !== null && s !== undefined ? formatNumber(s.playerCount) : '—'}
          hint={s?.maxPlayers ? `of ${s.maxPlayers} slots` : undefined}
          loading={status.isLoading}
        />
        <MetricCard
          label="TPS (1m)"
          icon={<Activity className="h-4 w-4" />}
          value={formatTps(sample?.tps1m)}
          tone={tpsTone(sample?.tps1m ?? null)}
          hint="target 20.00"
          loading={metrics.isLoading}
        />
        <MetricCard
          label="MSPT"
          icon={<Gauge className="h-4 w-4" />}
          value={formatMspt(sample?.mspt)}
          tone={msptTone(sample?.mspt ?? null)}
          hint="target ≤ 50 ms"
          loading={metrics.isLoading}
        />
        <MetricCard
          label="Heap used"
          icon={<HardDrive className="h-4 w-4" />}
          value={formatPercent(m?.heapUsedPercent ?? null)}
          tone={heapTone(m?.heapUsedPercent ?? null)}
          hint={
            sample?.heapUsedBytes != null && sample?.heapMaxBytes != null
              ? `${formatBytes(sample.heapUsedBytes)} / ${formatBytes(sample.heapMaxBytes)}`
              : undefined
          }
          loading={metrics.isLoading}
        />
        <MetricCard
          label="Uptime"
          icon={<Clock className="h-4 w-4" />}
          value={formatDuration(s?.uptimeSeconds ?? null)}
          loading={status.isLoading}
        />
        <MetricCard
          label="Agent"
          icon={<Plug className="h-4 w-4" />}
          value={s ? (s.agentConnected ? 'Connected' : 'Disconnected') : '—'}
          tone={s ? (s.agentConnected ? 'good' : 'bad') : 'default'}
          hint={s?.lastHeartbeatAt ? `heartbeat ${formatAgo(s.lastHeartbeatAt)}` : 'never'}
          loading={status.isLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="TPS"
            subtitle="Ticks per second, 1 / 5 / 15 minute averages"
            action={<RangeSelector value={range} onChange={setRange} />}
          />
          {history.isError ? (
            <ErrorState onRetry={() => void history.refetch()} />
          ) : (
            <MetricChart
              points={history.data?.points ?? []}
              series={[
                { key: 'tps1m', label: '1m', color: '#22d3ee', domain: [0, 20] },
                { key: 'tps5m', label: '5m', color: '#6366f1', domain: [0, 20] },
                { key: 'tps15m', label: '15m', color: '#a78bfa', domain: [0, 20] },
              ]}
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Memory" subtitle="JVM heap used vs. max" action={<RangeSelector value={range} onChange={setRange} />} />
          {history.isError ? (
            <ErrorState onRetry={() => void history.refetch()} />
          ) : (
            <MetricChart
              points={history.data?.points ?? []}
              series={[
                { key: 'heapUsedBytes', label: 'Used', color: '#34d399', format: 'bytes' },
                { key: 'heapMaxBytes', label: 'Max', color: '#64748b', format: 'bytes' },
              ]}
            />
          )}
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent events" subtitle="Most recent structured monitoring events" />
          {events.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : events.data && events.data.length > 0 ? (
            <EventList events={events.data} dense />
          ) : (
            <EmptyState
              title="No events yet"
              description="Events appear here as the agent reports joins, leaves, plugin changes and alerts."
            />
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Online players"
              subtitle={online.data ? `${online.data.total} online` : undefined}
              action={<Badge variant="accent">{online.data?.total ?? 0}</Badge>}
            />
            {online.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : online.data && online.data.items.length > 0 ? (
              <ul className="space-y-1.5">
                {online.data.items.slice(0, 6).map((p) => (
                  <li key={p.uuid} className="flex items-center justify-between text-sm">
                    <span className="truncate text-content">{p.lastKnownUsername}</span>
                    <span className="text-xs text-content-faint">
                      {p.currentSessionStartedAt ? formatAgo(p.currentSessionStartedAt) : ''}
                    </span>
                  </li>
                ))}
                {online.data.items.length > 6 ? (
                  <li className="text-xs text-content-faint">+{online.data.items.length - 6} more</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-xs text-content-muted">No players online.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Plugins" subtitle="From the latest inventory snapshot" />
            {plugins.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : plugins.data ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-semibold text-content">{plugins.data.pluginCount}</p>
                  <p className="text-xs text-content-faint">
                    collected {formatAgo(plugins.data.collectedAt)}
                  </p>
                </div>
                <div className="text-right text-xs text-content-muted">
                  <p>{plugins.data.plugins.filter((p) => p.enabled).length} enabled</p>
                  <p>{plugins.data.plugins.filter((p) => !p.enabled).length} disabled</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-content-muted">No plugin snapshot received yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
