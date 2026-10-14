import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  CheckCircle2,
  Pencil,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import clsx from 'clsx';
import type { AlertRule, AlertRuleInput, TestAlertResponse } from '@minepulse/shared';
import { ALERT_METRICS, ALERT_OPERATORS } from '@minepulse/shared';
import { useAlerts } from '../lib/queries';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, Spinner } from '../components/ui/primitives';
import { Dialog } from '../components/ui/Dialog';
import { formatAgo, formatDateTime, titleCase } from '../lib/format';
import {
  EMPTY_FORM,
  METRIC_LABELS,
  OPERATOR_LABELS,
  conditionText,
  deliveryVariant,
  formFromRule,
  parseForm,
  severityVariant,
  type FormState,
} from '../lib/alerts';

// Display + form helpers live in ../lib/alerts so they can be unit tested.

export function AlertsPage(): JSX.Element {
  const alerts = useAlerts();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AlertRule | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: AlertRuleInput & { id?: string }) => {
      const { id, ...body } = input;
      return id ? api.patch<AlertRule>(`/alerts/${id}`, body) : api.post<AlertRule>('/alerts', body);
    },
    onSuccess: (rule) => {
      invalidate();
      setDialogOpen(false);
      toast.success(editing ? `Updated "${rule.name}"` : `Created "${rule.name}"`);
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.message : 'Could not save the rule.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<void>(`/alerts/${id}`),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      toast.success('Alert rule deleted');
    },
    onError: (error) => {
      toast.error('Could not delete rule', error instanceof ApiError ? error.message : undefined);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (rule: AlertRule) =>
      api.patch<AlertRule>(`/alerts/${rule.id}`, { enabled: !rule.enabled }),
    onSuccess: (rule) => {
      invalidate();
      toast.info(rule.enabled ? `Enabled "${rule.name}"` : `Disabled "${rule.name}"`);
    },
    onError: (error) => {
      toast.error('Could not update rule', error instanceof ApiError ? error.message : undefined);
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post<TestAlertResponse>(`/alerts/${id}/test`),
    onSuccess: (result) => {
      invalidate();
      if (result.status === 'delivered') toast.success('Test notification delivered', result.message);
      else if (result.status === 'skipped') toast.info('Discord not configured', result.message);
      else toast.error('Test notification failed', result.message);
    },
    onError: (error) => {
      toast.error('Could not send test', error instanceof ApiError ? error.message : undefined);
    },
  });

  function openCreate(): void {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(rule: AlertRule): void {
    setEditing(rule);
    setForm(formFromRule(rule));
    setFormError(null);
    setDialogOpen(true);
  }

  function submitForm(e: React.FormEvent): void {
    e.preventDefault();
    setFormError(null);

    const parsed = parseForm(form);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }

    saveMutation.mutate({ id: editing?.id, ...parsed.value });
  }

  const rules = alerts.data?.rules ?? [];
  const incidents = alerts.data?.incidents ?? [];
  const openIncidents = useMemo(() => incidents.filter((i) => i.status === 'open'), [incidents]);
  const discordConfigured = alerts.data?.discordConfigured ?? false;

  if (alerts.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (alerts.isError) {
    return <ErrorState message={(alerts.error as Error | null)?.message} onRetry={() => void alerts.refetch()} />;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={<Bell className="h-4 w-4" />}
          title="Alerting"
          subtitle="Rules are evaluated every 10 seconds against live telemetry. An incident opens after two consecutive breaching samples and resolves after two healthy samples."
          action={
            isAdmin ? (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New rule
              </button>
            ) : null
          }
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {discordConfigured ? (
            <Badge variant="online">
              <Bell className="h-3.5 w-3.5" />
              Discord notifications configured
            </Badge>
          ) : (
            <Badge variant="stale">
              <BellOff className="h-3.5 w-3.5" />
              Discord not configured
            </Badge>
          )}
          <Badge variant="neutral">{rules.length} rules</Badge>
          <Badge variant={openIncidents.length > 0 ? 'critical' : 'neutral'}>
            {openIncidents.length} open incident{openIncidents.length === 1 ? '' : 's'}
          </Badge>
          {!isAdmin ? <Badge variant="neutral">Read-only (viewer role)</Badge> : null}
        </div>

        {!discordConfigured ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-severity-warning/30 bg-severity-warning/10 px-3 py-2 text-xs text-content-muted">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-severity-warning" />
            <p>
              Notifications are <span className="font-medium text-content">not configured</span>. Rules
              are still evaluated and incidents are recorded, but no Discord message is sent. Set{' '}
              <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px] text-content">
                DISCORD_WEBHOOK_URL
              </code>{' '}
              in the API <code className="font-mono text-[11px]">.env</code> and restart the API to
              enable delivery.
            </p>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Rules" subtitle="Thresholds are compared against the value right now." />
        {rules.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title="No alert rules yet"
            description={
              isAdmin
                ? 'Create a rule to start watching TPS, MSPT, heap usage, player count or heartbeat freshness.'
                : 'An administrator has not created any alert rules yet.'
            }
            action={
              isAdmin ? (
                <button type="button" className="btn-primary" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New rule
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-content-faint">
                  <th className="pb-2 pr-4 font-medium">Rule</th>
                  <th className="pb-2 pr-4 font-medium">Condition</th>
                  <th className="pb-2 pr-4 font-medium">Severity</th>
                  <th className="pb-2 pr-4 font-medium">Last triggered</th>
                  <th className="pb-2 pr-4 font-medium">Delivery</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className={clsx('table-row', !rule.enabled && 'opacity-60')}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-content">{rule.name}</p>
                      <p className="text-xs text-content-muted">
                        {METRIC_LABELS[rule.metric] ?? titleCase(rule.metric)} · window{' '}
                        {rule.evaluationWindowSeconds}s · cooldown {rule.cooldownSeconds}s
                      </p>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-content">
                      {conditionText(rule)}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={severityVariant(rule.severity)}>{titleCase(rule.severity)}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-xs text-content-muted">
                      {rule.lastTriggeredAt ? (
                        <span title={formatDateTime(rule.lastTriggeredAt)}>
                          {formatAgo(rule.lastTriggeredAt)}
                        </span>
                      ) : (
                        'never'
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={deliveryVariant(rule.lastDeliveryStatus)}>
                        {rule.lastDeliveryStatus}
                      </Badge>
                    </td>
                    <td className="py-3">
                      {isAdmin ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            onClick={() => toggleMutation.mutate(rule)}
                            disabled={toggleMutation.isPending}
                            title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                          >
                            {rule.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            onClick={() => testMutation.mutate(rule.id)}
                            disabled={testMutation.isPending}
                            title="Send a test notification"
                          >
                            {testMutation.isPending && testMutation.variables === rule.id ? (
                              <Spinner className="h-3.5 w-3.5" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Test
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            onClick={() => openEdit(rule)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs text-status-offline hover:text-status-offline"
                            onClick={() => setPendingDelete(rule)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-content-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Incidents"
          subtitle="Most recent 50 incidents across all rules."
          icon={<TriangleAlert className="h-4 w-4" />}
        />
        {incidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6" />}
            title="No incidents recorded"
            description="When a rule breaches its threshold for two consecutive samples, an incident appears here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-content-faint">
                  <th className="pb-2 pr-4 font-medium">Rule</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Started</th>
                  <th className="pb-2 pr-4 font-medium">Resolved</th>
                  <th className="pb-2 pr-4 font-medium">Value</th>
                  <th className="pb-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id} className="table-row">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-content">{incident.ruleName}</p>
                      <p className="text-xs text-content-muted">{conditionText({
                        metric: incident.ruleMetric,
                        operator: 'gt',
                        threshold: 0,
                      }).split(' ')[0]}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={incident.status === 'open' ? 'critical' : 'online'}>
                        {incident.status}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-xs text-content-muted" title={formatDateTime(incident.startedAt)}>
                      {formatAgo(incident.startedAt)}
                    </td>
                    <td className="py-3 pr-4 text-xs text-content-muted">
                      {incident.resolvedAt ? formatAgo(incident.resolvedAt) : '—'}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-content">
                      {incident.triggerValue !== null && incident.triggerValue !== undefined
                        ? Math.round(incident.triggerValue * 100) / 100
                        : '—'}
                    </td>
                    <td className="py-3 text-xs text-content-muted">{incident.summary ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Edit alert rule' : 'New alert rule'}
        description="Rules are evaluated every 10 seconds; two consecutive breaching samples open an incident."
        wide
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submitForm}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Spinner /> : null}
              {editing ? 'Save changes' : 'Create rule'}
            </button>
          </>
        }
      >
        <form onSubmit={submitForm} className="space-y-4">
          <div>
            <label className="label" htmlFor="rule-name">
              Name
            </label>
            <input
              id="rule-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="TPS below 15"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rule-metric">
                Metric
              </label>
              <select
                id="rule-metric"
                className="input"
                value={form.metric}
                onChange={(e) =>
                  setForm((f) => ({ ...f, metric: e.target.value as FormState['metric'] }))
                }
              >
                {ALERT_METRICS.map((metric) => (
                  <option key={metric} value={metric}>
                    {METRIC_LABELS[metric] ?? metric}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="rule-operator">
                Operator
              </label>
              <select
                id="rule-operator"
                className="input"
                value={form.operator}
                onChange={(e) =>
                  setForm((f) => ({ ...f, operator: e.target.value as FormState['operator'] }))
                }
              >
                {ALERT_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op} ({OPERATOR_LABELS[op]})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="rule-threshold">
                Threshold
              </label>
              <input
                id="rule-threshold"
                className="input"
                type="number"
                step="any"
                value={form.threshold}
                onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="rule-severity">
                Severity
              </label>
              <select
                id="rule-severity"
                className="input"
                value={form.severity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, severity: e.target.value as FormState['severity'] }))
                }
              >
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="rule-window">
                Evaluation window (seconds)
              </label>
              <input
                id="rule-window"
                className="input"
                type="number"
                min={10}
                max={3600}
                value={form.evaluationWindowSeconds}
                onChange={(e) => setForm((f) => ({ ...f, evaluationWindowSeconds: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="rule-cooldown">
                Cooldown (seconds)
              </label>
              <input
                id="rule-cooldown"
                className="input"
                type="number"
                min={0}
                max={86400}
                value={form.cooldownSeconds}
                onChange={(e) => setForm((f) => ({ ...f, cooldownSeconds: e.target.value }))}
                required
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-content">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border bg-surface-muted"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enabled
          </label>

          <p className="text-xs text-content-muted">
            Preview: <span className="font-mono text-content">{conditionText({
              metric: form.metric,
              operator: form.operator,
              threshold: Number(form.threshold) || 0,
            })}</span>
          </p>

          {formError ? (
            <div className="rounded-lg border border-status-offline/30 bg-status-offline/10 px-3 py-2 text-xs text-status-offline">
              {formError}
            </div>
          ) : null}

          <button type="submit" className="hidden" aria-hidden />
        </form>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete alert rule"
        description={`Delete "${pendingDelete?.name ?? ''}"? Its incident history will be removed too.`}
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Spinner /> : null}
              Delete
            </button>
          </>
        }
      />
    </div>
  );
}
