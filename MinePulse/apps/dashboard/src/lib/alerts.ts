import type { AlertRule, AlertRuleInput } from '@minepulse/shared';

/**
 * Pure display + form helpers for the Alerts page. Kept free of React so they
 * can be unit tested in the node environment.
 */

export const METRIC_LABELS: Record<string, string> = {
  heartbeat_missing: 'Heartbeat missing (seconds)',
  agent_disconnected: 'Agent disconnected (seconds)',
  tps: 'TPS (1m)',
  mspt: 'MSPT (ms)',
  heap_percent: 'Heap used (%)',
  player_count: 'Player count',
  repeated_incidents: 'Repeated incidents (count)',
};

export const METRIC_SHORT: Record<string, string> = {
  heartbeat_missing: 'no heartbeat',
  agent_disconnected: 'no telemetry',
  tps: 'TPS',
  mspt: 'MSPT',
  heap_percent: 'heap',
  player_count: 'players',
  repeated_incidents: 'incidents',
};

export const OPERATOR_LABELS: Record<string, string> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
};

export function conditionText(
  rule: Pick<AlertRule, 'metric' | 'operator' | 'threshold'>,
): string {
  return `${METRIC_SHORT[rule.metric] ?? rule.metric} ${OPERATOR_LABELS[rule.operator] ?? rule.operator} ${rule.threshold}`;
}

export function severityVariant(severity: string): string {
  return severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
}

export function deliveryVariant(status: string): string {
  if (status === 'delivered') return 'online';
  if (status === 'failed') return 'offline';
  if (status === 'skipped') return 'stale';
  return 'neutral';
}

export interface FormState {
  name: string;
  metric: AlertRuleInput['metric'];
  operator: AlertRuleInput['operator'];
  threshold: string;
  evaluationWindowSeconds: string;
  severity: AlertRuleInput['severity'];
  cooldownSeconds: string;
  enabled: boolean;
  notifyDiscord: boolean;
}

export const EMPTY_FORM: FormState = {
  name: '',
  metric: 'tps',
  operator: 'lt',
  threshold: '15',
  evaluationWindowSeconds: '60',
  severity: 'warning',
  cooldownSeconds: '600',
  enabled: true,
  notifyDiscord: true,
};

export function formFromRule(rule: AlertRule): FormState {
  return {
    name: rule.name,
    metric: rule.metric,
    operator: rule.operator,
    threshold: String(rule.threshold),
    evaluationWindowSeconds: String(rule.evaluationWindowSeconds),
    severity: rule.severity,
    cooldownSeconds: String(rule.cooldownSeconds),
    enabled: rule.enabled,
    notifyDiscord: rule.notifyDiscord,
  };
}

/** Validate raw form strings into a normalised payload (or an error message). */
export function parseForm(
  form: FormState,
): { ok: true; value: AlertRuleInput } | { ok: false; error: string } {
  const threshold = Number(form.threshold);
  const windowSeconds = Number(form.evaluationWindowSeconds);
  const cooldownSeconds = Number(form.cooldownSeconds);

  if (!form.name.trim()) return { ok: false, error: 'Name is required.' };
  if (!Number.isFinite(threshold)) return { ok: false, error: 'Threshold must be a number.' };
  if (!Number.isFinite(windowSeconds) || windowSeconds < 10 || windowSeconds > 3600)
    return { ok: false, error: 'Evaluation window must be between 10 and 3600 seconds.' };
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86400)
    return { ok: false, error: 'Cooldown must be between 0 and 86400 seconds.' };

  return {
    ok: true,
    value: {
      name: form.name.trim(),
      metric: form.metric,
      operator: form.operator,
      threshold,
      evaluationWindowSeconds: windowSeconds,
      severity: form.severity,
      cooldownSeconds,
      enabled: form.enabled,
      notifyDiscord: form.notifyDiscord,
    },
  };
}
