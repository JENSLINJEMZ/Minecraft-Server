import { z } from 'zod';
import { isoDateTime } from './common.js';
import { ALERT_METRICS, ALERT_OPERATORS } from '../constants.js';

export const alertMetricSchema = z.enum(ALERT_METRICS);
export const alertOperatorSchema = z.enum(ALERT_OPERATORS);
export const severitySchema = z.enum(['info', 'warning', 'critical']);

/** Create/update payload for an alert rule. */
export const alertRuleInputSchema = z.object({
  name: z.string().min(1).max(120),
  metric: alertMetricSchema,
  operator: alertOperatorSchema,
  threshold: z.number(),
  evaluationWindowSeconds: z.number().int().min(10).max(3600).default(60),
  severity: severitySchema.default('warning'),
  cooldownSeconds: z.number().int().min(0).max(86400).default(600),
  enabled: z.boolean().default(true),
  /** Per-rule Discord delivery. In-app incidents are always created. */
  notifyDiscord: z.boolean().default(true),
});
export type AlertRuleInput = z.infer<typeof alertRuleInputSchema>;

export const alertRulePatchSchema = alertRuleInputSchema.partial();
export type AlertRulePatch = z.infer<typeof alertRulePatchSchema>;

export const alertRuleSchema = alertRuleInputSchema.extend({
  id: z.string(),
  serverId: z.string(),
  /** Set while the rule is snoozed; evaluation is skipped until then. */
  mutedUntil: isoDateTime.nullable(),
  lastTriggeredAt: isoDateTime.nullable(),
  lastDeliveryStatus: z.enum(['pending', 'delivered', 'failed', 'skipped', 'none']).default('none'),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const alertIncidentStatusSchema = z.enum(['open', 'acknowledged', 'resolved']);
export type AlertIncidentStatus = z.infer<typeof alertIncidentStatusSchema>;

export const alertIncidentSchema = z.object({
  id: z.string(),
  alertRuleId: z.string(),
  startedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  lastNotifiedAt: isoDateTime.nullable(),
  status: alertIncidentStatusSchema,
  triggerValue: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
});
export type AlertIncident = z.infer<typeof alertIncidentSchema>;

/** Snooze an incident or mute a rule for a bounded number of minutes. */
export const alertSnoozeInputSchema = z.object({
  minutes: z.number().int().min(1).max(1440).default(30),
});
export type AlertSnoozeInput = z.infer<typeof alertSnoozeInputSchema>;

export const notificationDeliverySchema = z.object({
  id: z.string(),
  alertIncidentId: z.string(),
  channel: z.enum(['discord', 'none']),
  status: z.enum(['pending', 'delivered', 'failed', 'skipped']),
  attemptCount: z.number().int().nonnegative(),
  deliveredAt: isoDateTime.nullable(),
  errorSummary: z.string().nullable(),
});
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

export const testAlertResponseSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['delivered', 'failed', 'skipped']),
  message: z.string(),
});
export type TestAlertResponse = z.infer<typeof testAlertResponseSchema>;

/** An incident joined with its rule, for the alerts overview list. */
export const alertIncidentViewSchema = alertIncidentSchema.extend({
  ruleName: z.string(),
  ruleMetric: alertMetricSchema,
  ruleSeverity: severitySchema,
});
export type AlertIncidentView = z.infer<typeof alertIncidentViewSchema>;

/** Live value a rule is currently compared against, for the alerts sidebar. */
export const alertRuleStatusSchema = z.object({
  ruleId: z.string(),
  /** Null when the metric has no telemetry to evaluate yet. */
  value: z.number().nullable(),
  breaching: z.boolean().nullable(),
});
export type AlertRuleStatus = z.infer<typeof alertRuleStatusSchema>;

/** Cadence and hysteresis actually used by the API evaluator. */
export const alertEvaluationSchema = z.object({
  intervalSeconds: z.number(),
  triggerEvaluations: z.number(),
  resolveEvaluations: z.number(),
});
export type AlertEvaluation = z.infer<typeof alertEvaluationSchema>;

/** Everything the Alerts page needs in one round-trip. */
export const alertsOverviewSchema = z.object({
  rules: z.array(alertRuleSchema),
  incidents: z.array(alertIncidentViewSchema),
  /** Derived, read-only: whether a Discord webhook is configured on the backend. */
  discordConfigured: z.boolean(),
  /** Current metric reading for every rule (null value = no telemetry). */
  ruleStatus: z.array(alertRuleStatusSchema),
  evaluation: alertEvaluationSchema,
});
export type AlertsOverview = z.infer<typeof alertsOverviewSchema>;
