import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricPoint } from '@minepulse/shared';
import { formatBytes, formatClock } from '../../lib/format';

export interface ChartSeries {
  key: keyof MetricPoint;
  label: string;
  color: string;
  /** Y-axis domain, e.g. [0, 20] for TPS. */
  domain?: [number, number];
  unit?: string;
  /** Value formatting for tooltips. */
  format?: 'bytes';
  /** Put this series on a second (right) Y axis. */
  axis?: 'left' | 'right';
}

interface Row {
  t: number;
  label: string;
  [key: string]: number | string | null;
}

function toRows(points: MetricPoint[], series: ChartSeries[]): Row[] {
  return points.map((p) => {
    const row: Row = {
      t: new Date(p.recordedAt).getTime(),
      label: formatClock(p.recordedAt),
    };
    for (const s of series) {
      const raw = p[s.key];
      row[s.key as string] = typeof raw === 'number' ? raw : null;
    }
    return row;
  });
}

export function MetricChart({
  points,
  series,
  height = 260,
  emptyLabel = 'No data in this range yet.',
}: {
  points: MetricPoint[];
  series: ChartSeries[];
  height?: number;
  emptyLabel?: string;
}): JSX.Element {
  if (!points || points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-content-faint"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const rows = toRows(points, series);
  const leftSeries = series.filter((s) => s.axis !== 'right');
  const rightSeries = series.filter((s) => s.axis === 'right');
  const leftDomain = leftSeries.find((s) => s.domain)?.domain;
  const rightDomain = rightSeries.find((s) => s.domain)?.domain;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: rightSeries.length ? 8 : 4, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#1b2532" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#24303f' }}
            minTickGap={40}
          />
          <YAxis
            yAxisId="left"
            domain={leftDomain ?? ['auto', 'auto']}
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#24303f' }}
            width={44}
          />
          {rightSeries.length ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={rightDomain ?? ['auto', 'auto']}
              tick={{ fill: '#64748b', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#24303f' }}
              width={44}
            />
          ) : null}
          <Tooltip
            contentStyle={{
              background: '#121821',
              border: '1px solid #24303f',
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: '#93a4b8' }}
            itemStyle={{ color: '#e6edf5' }}
            formatter={(value: number | string, name: string) => {
              const s = series.find((x) => x.label === name);
              if (typeof value !== 'number') return [value, name];
              if (s?.format === 'bytes') return [formatBytes(value), name];
              return [`${value.toFixed(2)}${s?.unit ?? ''}`, name];
            }}
          />
          {series.map((s) => (
            <Line
              key={s.key as string}
              yAxisId={s.axis === 'right' ? 'right' : 'left'}
              type="monotone"
              dataKey={s.key as string}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
