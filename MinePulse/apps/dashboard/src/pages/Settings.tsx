import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Bell,
  BellOff,
  Database,
  Download,
  Gauge,
  Save,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { Settings } from '@minepulse/shared';
import { METRIC_RANGES } from '@minepulse/shared';
import { useSettings, useUpdateSettings } from '../lib/queries';
import { ApiError, downloadFile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Badge, Card, CardHeader, ErrorState, Skeleton, Spinner } from '../components/ui/primitives';

type NumericField =
  | 'retentionRawMetricsDays'
  | 'retentionAggregated1mDays'
  | 'retentionAggregated1hDays'
  | 'retentionEventsDays'
  | 'retentionPlayerSessionsDays'
  | 'heartbeatStaleSeconds'
  | 'heartbeatOfflineSeconds';

const RETENTION_FIELDS: Array<{ key: NumericField; label: string; hint: string }> = [
  { key: 'retentionRawMetricsDays', label: 'Raw metric samples', hint: 'High-resolution telemetry used for 15m–1h charts.' },
  { key: 'retentionAggregated1mDays', label: '1-minute rollups', hint: 'Feeds 6h–24h charts.' },
  { key: 'retentionAggregated1hDays', label: '1-hour rollups', hint: 'Feeds the 7-day chart.' },
  { key: 'retentionEventsDays', label: 'Events', hint: 'Events & logs history.' },
  { key: 'retentionPlayerSessionsDays', label: 'Closed player sessions', hint: 'Session history for players who have left.' },
];

const THRESHOLD_FIELDS: Array<{ key: NumericField; label: string; hint: string }> = [
  { key: 'heartbeatStaleSeconds', label: 'Stale after (seconds)', hint: 'No heartbeat within this window marks the server stale.' },
  { key: 'heartbeatOfflineSeconds', label: 'Offline after (seconds)', hint: 'No heartbeat within this window marks the server offline.' },
];

type FormValues = Record<NumericField, string>;

function toForm(settings: Settings): FormValues {
  const entries = [...RETENTION_FIELDS, ...THRESHOLD_FIELDS].map(
    (f) => [f.key, String(settings[f.key])] as const,
  );
  return Object.fromEntries(entries) as FormValues;
}

export function SettingsPage(): JSX.Element {
  const settings = useSettings();
  const update = useUpdateSettings();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState<FormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportingMetrics, setExportingMetrics] = useState(false);
  const [exportingEvents, setExportingEvents] = useState(false);
  const [range, setRange] = useState<string>('1h');

  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);

  const dirty = useMemo(() => {
    if (!settings.data || !form) return false;
    const base = toForm(settings.data);
    return (Object.keys(base) as NumericField[]).some((key) => base[key] !== form[key]);
  }, [settings.data, form]);

  async function onExportMetrics(): Promise<void> {
    setExportingMetrics(true);
    try {
      await downloadFile(`/export/metrics?range=${range}`, `minepulse-metrics-${range}.csv`);
      toast.success('Metrics export downloaded');
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setExportingMetrics(false);
    }
  }

  async function onExportEvents(): Promise<void> {
    setExportingEvents(true);
    try {
      await downloadFile('/export/events', 'minepulse-events.csv');
      toast.success('Events export downloaded');
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setExportingEvents(false);
    }
  }

  function save(): void {
    if (!form || !settings.data) return;
    setError(null);

    const patch: Partial<Record<NumericField, number>> = {};
    for (const field of [...RETENTION_FIELDS, ...THRESHOLD_FIELDS]) {
      const raw = form[field.key];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        setError(`${field.label} must be a whole number of at least 1.`);
        return;
      }
      if (value !== settings.data[field.key]) patch[field.key] = value;
    }

    if (Object.keys(patch).length === 0) {
      toast.info('Nothing to save');
      return;
    }

    update.mutate(patch as Record<string, number>, {
      onSuccess: () => toast.success('Settings saved'),
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'Could not save settings.'),
    });
  }

  if (settings.isLoading || !form) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <ErrorState
        message={(settings.error as Error | null)?.message}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  const data = settings.data;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={<SettingsIcon className="h-4 w-4" />}
          title="Settings"
          subtitle="Retention windows, offline detection thresholds and data export."
          action={
            isAdmin ? (
              <button type="button" className="btn-primary" onClick={save} disabled={!dirty || update.isPending}>
                {update.isPending ? <Spinner /> : <Save className="h-4 w-4" />}
                Save changes
              </button>
            ) : null
          }
        />
        {!isAdmin ? (
          <Badge variant="neutral">Read-only (viewer role)</Badge>
        ) : dirty ? (
          <Badge variant="warning">Unsaved changes</Badge>
        ) : (
          <Badge variant="neutral">All changes saved</Badge>
        )}
      </Card>

      <Card>
        <CardHeader
          icon={<Gauge className="h-4 w-4" />}
          title="Offline detection"
          subtitle="How long without a heartbeat before the server is marked stale or offline."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {THRESHOLD_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="label" htmlFor={field.key}>
                {field.label}
              </label>
              <input
                id={field.key}
                type="number"
                min={5}
                className="input"
                value={form[field.key]}
                disabled={!isAdmin}
                onChange={(e) => setForm((f) => (f ? { ...f, [field.key]: e.target.value } : f))}
              />
              <p className="mt-1 text-xs text-content-muted">{field.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<Database className="h-4 w-4" />}
          title="Data retention"
          subtitle="Older data is pruned by the retention job (runs every six hours). Raise these if you need longer history."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RETENTION_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="label" htmlFor={field.key}>
                {field.label} (days)
              </label>
              <input
                id={field.key}
                type="number"
                min={1}
                max={3650}
                className="input"
                value={form[field.key]}
                disabled={!isAdmin}
                onChange={(e) => setForm((f) => (f ? { ...f, [field.key]: e.target.value } : f))}
              />
              <p className="mt-1 text-xs text-content-muted">{field.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<Bell className="h-4 w-4" />}
          title="Notifications"
          subtitle="Discord alert delivery is configured on the API host, never here."
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {data.discordConfigured ? (
            <Badge variant="online">
              <Bell className="h-3.5 w-3.5" />
              Discord webhook configured
            </Badge>
          ) : (
            <Badge variant="stale">
              <BellOff className="h-3.5 w-3.5" />
              Discord not configured
            </Badge>
          )}
        </div>
        <p className="mt-3 text-xs text-content-muted">
          {data.discordConfigured
            ? 'Alert incidents are posted to the configured Discord webhook.'
            : 'Alerts are evaluated and recorded, but no messages are sent. Set DISCORD_WEBHOOK_URL in the API .env and restart the API to enable delivery.'}
        </p>
      </Card>

      <Card>
        <CardHeader
          icon={<Download className="h-4 w-4" />}
          title="Data export"
          subtitle="Download the underlying data as CSV."
        />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="export-range">
              Metrics range
            </label>
            <select
              id="export-range"
              className="input w-36"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              {METRIC_RANGES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-outline"
            onClick={() => void onExportMetrics()}
            disabled={exportingMetrics}
          >
            {exportingMetrics ? <Spinner /> : <Download className="h-4 w-4" />}
            Export metrics
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => void onExportEvents()}
            disabled={exportingEvents}
          >
            {exportingEvents ? <Spinner /> : <Download className="h-4 w-4" />}
            Export events
          </button>
        </div>
      </Card>

      {error ? (
        <div className={clsx('rounded-lg border border-status-offline/30 bg-status-offline/10 px-3 py-2 text-xs text-status-offline')}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
