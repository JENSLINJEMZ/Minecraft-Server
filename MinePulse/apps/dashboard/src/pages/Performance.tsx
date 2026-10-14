import { useState } from 'react';
import { Cpu, Gauge, HardDrive, Info } from 'lucide-react';
import { useCurrentMetrics, useMetricHistory, useServerStatus } from '../lib/queries';
import { MetricCard } from '../components/metrics/MetricCard';
import { MetricChart } from '../components/charts/MetricChart';
import { RangeSelector } from '../components/common/RangeSelector';
import { Card, CardHeader, ErrorState, Skeleton } from '../components/ui/primitives';
import {
  formatBytes,
  formatDuration,
  formatMspt,
  formatPercent,
  formatTps,
} from '../lib/format';

export function PerformancePage(): JSX.Element {
  const [range, setRange] = useState('1h');
  const status = useServerStatus();
  const metrics = useCurrentMetrics();
  const history = useMetricHistory(range);

  const s = status.data;
  const m = metrics.data;
  const sample = m?.sample ?? null;

  if (metrics.isError) {
    return <ErrorState message="Could not load performance data." onRetry={() => void metrics.refetch()} />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="TPS 1m" value={formatTps(sample?.tps1m)} loading={metrics.isLoading} hint="target 20.00" />
        <MetricCard label="TPS 5m" value={formatTps(sample?.tps5m)} loading={metrics.isLoading} />
        <MetricCard label="TPS 15m" value={formatTps(sample?.tps15m)} loading={metrics.isLoading} />
        <MetricCard
          label="MSPT"
          icon={<Gauge className="h-4 w-4" />}
          value={formatMspt(sample?.mspt)}
          loading={metrics.isLoading}
          hint="milliseconds per tick"
        />
        <MetricCard
          label="Heap used"
          icon={<HardDrive className="h-4 w-4" />}
          value={formatBytes(sample?.heapUsedBytes)}
          loading={metrics.isLoading}
          hint={sample?.heapMaxBytes ? `max ${formatBytes(sample.heapMaxBytes)}` : undefined}
        />
        <MetricCard
          label="Uptime"
          value={formatDuration(s?.uptimeSeconds ?? null)}
          loading={status.isLoading}
          hint={sample?.recordedAt ? `sample ${formatPercent(m?.heapUsedPercent ?? null)} heap` : undefined}
        />
      </div>

      <Card>
        <CardHeader title="TPS history" subtitle="1 / 5 / 15 minute averages" action={<RangeSelector value={range} onChange={setRange} />} />
        {history.isError ? (
          <ErrorState onRetry={() => void history.refetch()} />
        ) : history.isLoading ? (
          <Skeleton className="h-[260px] w-full" />
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="MSPT history" subtitle="Milliseconds per tick" />
          {history.isLoading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : (
            <MetricChart
              points={history.data?.points ?? []}
              series={[{ key: 'mspt', label: 'MSPT', color: '#f59e0b', unit: ' ms' }]}
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Player count" subtitle="Concurrent players (from rollups for long ranges)" />
          {history.isLoading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : (
            <MetricChart
              points={history.data?.points ?? []}
              series={[{ key: 'playerCount', label: 'Players', color: '#34d399' }]}
            />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Metric availability" icon={<Info className="h-4 w-4" />} subtitle="What this agent can and cannot measure" />
        <ul className="space-y-2 text-xs text-content-muted">
          <li className="flex items-start gap-2">
            <Cpu className="mt-0.5 h-3.5 w-3.5 text-content-faint" />
            <span>
              <span className="text-content">CPU usage</span>:{' '}
              {sample?.cpuUsagePercent !== null && sample?.cpuUsagePercent !== undefined ? (
                formatPercent(sample.cpuUsagePercent)
              ) : (
                <span className="text-severity-warning">Unavailable</span>
              )}{' '}
              — process CPU is not reliably measurable from the Paper plugin alone.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <HardDrive className="mt-0.5 h-3.5 w-3.5 text-content-faint" />
            <span>
              <span className="text-content">Heap</span>: used {formatBytes(sample?.heapUsedBytes)}, committed{' '}
              {formatBytes(sample?.heapCommittedBytes)}, max {formatBytes(sample?.heapMaxBytes)}.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Gauge className="mt-0.5 h-3.5 w-3.5 text-content-faint" />
            <span>
              <span className="text-content">MSPT</span> is a bounded rolling calculation reported by the agent,
              not a full server profile.
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
