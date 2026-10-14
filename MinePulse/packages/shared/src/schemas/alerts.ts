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
});
export type AlertRuleInput = z.infer<typeof alertRuleInputSchema>;

export const alertRulePatchSchema = alertRuleInputSchema.partial();
export type AlertRulePatch = z.infer<typeof alertRulePatchSchema>;

export const alertRuleSchema = alertRuleInputSchema.extend({
  id: z.string(),
  serverId: z.string(),
  lastTriggeredAt: isoDateTime.nullable(),
  lastDeliveryStatus: z.enum(['pending', 'delivered', 'failed', 'skipped', 'none']).default('none'),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const alertIncidentSchema = z.object({
  id: z.string(),
  alertRuleId: z.string(),
  startedAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
  lastNotifiedAt: isoDateTime.nullable(),
  status: z.enum(['open', 'resolved']),
  triggerValue: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
});
export type AlertIncident = z.infer<typeof alertIncidentSchema>;

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

/** Everything the Alerts page needs in one round-trip. */
export const alertsOverviewSchema = z.object({
  rules: z.array(alertRuleSchema),
  incidents: z.array(alertIncidentViewSchema),
  /** Derived, read-only: whether a Discord webhook is configured on the backend. */
  discordConfigured: z.boolean(),
});
export type AlertsOverview = z.infer<typeof alertsOverviewSchema>;
