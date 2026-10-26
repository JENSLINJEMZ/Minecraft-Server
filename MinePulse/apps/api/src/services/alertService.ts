import type {
  AlertIncident as DbAlertIncident,
  AlertRule as DbAlertRule,
  MetricSample as DbMetricSample,
  Server as DbServer,
  ServerHeartbeat as DbServerHeartbeat,
} from '@prisma/client';
import type {
  AlertIncident,
  AlertRule,
  AlertRuleStatus,
  AlertsOverview,
  AlertIncidentView,
  ServerEventInput,
  TestAlertResponse,
} from '@minepulse/shared';
import { alertRepository } from '../repositories/alertRepository.js';
import { eventRepository } from '../repositories/eventRepository.js';
import { heartbeatRepository } from '../repositories/heartbeatRepository.js';
import { metricRepository } from '../repositories/metricRepository.js';
import { bus } from '../realtime/bus.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { toAlertIncident, toAlertIncidentView, toAlertRule, toServerEvent } from './dto.js';
import { discordService, isDiscordConfigured } from './discordService.js';
import { getPrimaryServer } from './serverContext.js';

/**
 * Alert evaluation runs on a fixed cadence. A rule must breach for
 * TRIGGER_CONSECUTIVE evaluations in a row before an incident opens, and be
 * healthy for RESOLVE_CONSECUTIVE in a row before it resolves. This hysteresis
 * stops a single noisy sample from flapping an incident open/closed.
 */
export const ALERT_EVALUATION_INTERVAL_MS = 10_000;
const TRIGGER_CONSECUTIVE = 2;
const RESOLVE_CONSECUTIVE = 2;

export interface RuleState {
  breachStreak: number;
  okStreak: number;
}

const ruleState = new Map<string, RuleState>();

function stateFor(ruleId: string): RuleState {
  let s = ruleState.get(ruleId);
  if (!s) {
    s = { breachStreak: 0, okStreak: 0 };
    ruleState.set(ruleId, s);
  }
  return s;
}

interface EvalContext {
  server: DbServer;
  heartbeat: DbServerHeartbeat | null;
  sample: DbMetricSample | null;
  now: number;
  hbAgeSeconds: number | null;
  telemetryAgeSeconds: number | null;
  heapPercent: number | null;
}

export function compareValue(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'eq':
      return value === threshold;
    default:
      return false;
  }
}

/** Advance a rule's consecutive-sample counters for one evaluation. */
export function advanceStreak(state: RuleState, breaching: boolean): void {
  if (breaching) {
    state.breachStreak += 1;
    state.okStreak = 0;
  } else {
    state.okStreak += 1;
    state.breachStreak = 0;
  }
}

export type RuleAction = 'open' | 'resolve' | 'none';

/** Decide what to do given the streaks and whether an incident is already open. */
export function decideAction(state: RuleState, hasOpenIncident: boolean): RuleAction {
  if (!hasOpenIncident && state.breachStreak >= TRIGGER_CONSECUTIVE) return 'open';
  if (hasOpenIncident && state.okStreak >= RESOLVE_CONSECUTIVE) return 'resolve';
  return 'none';
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** Resolve the numeric value a rule is evaluated against, or null when unknown. */
async function resolveValue(ctx: EvalContext, rule: DbAlertRule): Promise<number | null> {
  switch (rule.metric) {
    case 'heartbeat_missing':
      return ctx.hbAgeSeconds;
    case 'agent_disconnected':
      return ctx.telemetryAgeSeconds;
    case 'tps':
      return ctx.sample?.tps1m ?? null;
    case 'mspt':
      return ctx.sample?.mspt ?? null;
    case 'heap_percent':
      return ctx.heapPercent;
    case 'player_count':
      return ctx.heartbeat?.playerCount ?? null;
    case 'repeated_incidents': {
      const windowSeconds = rule.evaluationWindowSeconds;
      return alertRepository.countIncidentsSince(rule.id, new Date(ctx.now - windowSeconds * 1000));
    }
    default:
      return null;
  }
}

function describe(rule: DbAlertRule, value: number): string {
  return `${rule.name}: ${rule.metric} is ${round(value)} (${rule.operator} ${rule.threshold})`;
}

function severityColor(severity: string): number {
  if (severity === 'critical') return 0xef4444;
  if (severity === 'warning') return 0xf59e0b;
  return 0x3b82f6;
}

function buildMessage(
  rule: DbAlertRule,
  incident: DbAlertIncident,
  kind: 'triggered' | 'resolved',
): { title: string; description: string; color: number; fields: { name: string; value: string; inline: boolean }[] } {
  return {
    title: `${kind === 'triggered' ? 'Alert triggered' : 'Alert resolved'}: ${rule.name}`,
    description: incident.summary ?? '',
    color: kind === 'triggered' ? severityColor(rule.severity) : 0x22c55e,
    fields: [
      { name: 'Metric', value: rule.metric, inline: true },
      { name: 'Condition', value: `${rule.operator} ${rule.threshold}`, inline: true },
      {
        name: 'Value',
        value: incident.triggerValue !== null ? String(round(incident.triggerValue)) : '—',
        inline: true,
      },
      { name: 'Severity', value: rule.severity, inline: true },
    ],
  };
}

async function emitEvent(serverId: string, event: ServerEventInput): Promise<void> {
  const { rows } = await eventRepository.createMany(
    serverId,
    [event],
    `alert-${Date.now()}-${event.type}`,
  );
  for (const row of rows) bus.publish('event', toServerEvent(row));
}

/** Send a notification for an incident transition and record the delivery. */
async function deliver(
  ctx: EvalContext,
  rule: DbAlertRule,
  incident: DbAlertIncident,
  kind: 'triggered' | 'resolved',
): Promise<void> {
  // Per-rule channel choice. In-app incidents are still created regardless.
  if (!rule.notifyDiscord) return;
  const outcome = await discordService.send(buildMessage(rule, incident, kind));

  await alertRepository.createDelivery({
    alertIncidentId: incident.id,
    channel: outcome.status === 'skipped' ? 'none' : 'discord',
    status: outcome.status,
    attemptCount: outcome.attempts,
    deliveredAt: outcome.status === 'delivered' ? new Date() : null,
    errorSummary: outcome.errorSummary,
  });
  await alertRepository.updateRule(rule.id, { lastDeliveryStatus: outcome.status });
  if (outcome.status !== 'skipped') {
    await alertRepository.markIncidentNotified(incident.id, new Date());
  }

  if (outcome.status === 'delivered') {
    await emitEvent(ctx.server.id, {
      type: 'alert_delivered',
      severity: 'info',
      occurredAt: new Date().toISOString(),
      summary: `Alert ${kind} notification delivered: ${rule.name}`,
      details: { ruleId: rule.id, incidentId: incident.id, channel: 'discord' },
    });
  } else if (outcome.status === 'failed') {
    await emitEvent(ctx.server.id, {
      type: 'alert_delivery_failed',
      severity: 'warning',
      occurredAt: new Date().toISOString(),
      summary: `Alert ${kind} notification failed: ${rule.name}`,
      details: { ruleId: rule.id, incidentId: incident.id, error: outcome.errorSummary },
    });
  }
}

async function openIncident(ctx: EvalContext, rule: DbAlertRule, value: number): Promise<void> {
  // Respect the cooldown between separate incidents for the same rule.
  if (
    rule.lastTriggeredAt &&
    ctx.now - rule.lastTriggeredAt.getTime() < rule.cooldownSeconds * 1000
  ) {
    return;
  }

  const summary = describe(rule, value);
  const incident = await alertRepository.openIncident(rule.id, value, summary);
  const triggeredAt = new Date(ctx.now);
  const updatedRule = await alertRepository.updateRule(rule.id, { lastTriggeredAt: triggeredAt });

  bus.publish('alert:triggered', {
    rule: toAlertRule(updatedRule),
    incident: toAlertIncident(incident),
  });

  await deliver(ctx, updatedRule, incident, 'triggered');
}

async function resolveIncident(
  ctx: EvalContext,
  rule: DbAlertRule,
  open: DbAlertIncident,
): Promise<void> {
  const resolved = await alertRepository.resolveIncident(open.id, new Date(ctx.now));
  bus.publish('alert:resolved', {
    rule: toAlertRule(rule),
    incident: toAlertIncident(resolved),
  });
  await deliver(ctx, rule, resolved, 'resolved');
}

async function evaluateRule(ctx: EvalContext, rule: DbAlertRule): Promise<void> {
  const value = await resolveValue(ctx, rule);
  const state = stateFor(rule.id);

  if (value === null) {
    // No data to judge on: hold state rather than opening a false incident.
    return;
  }

  const breaching = compareValue(value, rule.operator, rule.threshold);
  advanceStreak(state, breaching);

  const open = await alertRepository.findOpenIncident(rule.id);
  const action = decideAction(state, Boolean(open));
  if (action === 'open') {
    await openIncident(ctx, rule, value);
  } else if (action === 'resolve' && open) {
    await resolveIncident(ctx, rule, open);
  }
}

/** Build the shared evaluation context from the newest telemetry. */
async function buildEvalContext(now = Date.now()): Promise<EvalContext> {
  const server = await getPrimaryServer();
  const [heartbeat, sample] = await Promise.all([
    heartbeatRepository.latest(server.id),
    metricRepository.latest(server.id),
  ]);

  const hbAgeSeconds = heartbeat ? (now - heartbeat.receivedAt.getTime()) / 1000 : null;
  const metricAgeSeconds = sample ? (now - sample.recordedAt.getTime()) / 1000 : null;
  const telemetryAges = [hbAgeSeconds, metricAgeSeconds].filter((v): v is number => v !== null);
  const telemetryAgeSeconds = telemetryAges.length ? Math.min(...telemetryAges) : null;

  const heapUsed = sample && sample.heapUsedBytes !== null ? Number(sample.heapUsedBytes) : null;
  const heapMax = sample && sample.heapMaxBytes !== null ? Number(sample.heapMaxBytes) : null;
  const heapPercent = heapUsed !== null && heapMax ? (heapUsed / heapMax) * 100 : null;

  return {
    server,
    heartbeat,
    sample,
    now,
    hbAgeSeconds,
    telemetryAgeSeconds,
    heapPercent,
  };
}

/** Evaluate every enabled, unmuted rule for the primary server exactly once. */
export async function runAlertEvaluation(): Promise<void> {
  const server = await getPrimaryServer();
  const rules = await alertRepository.listRules(server.id);
  if (rules.length === 0) return;

  const ctx = await buildEvalContext();

  for (const rule of rules) {
    const muted = rule.mutedUntil !== null && rule.mutedUntil.getTime() > ctx.now;
    if (!rule.enabled || muted) {
      ruleState.delete(rule.id);
      continue;
    }
    try {
      await evaluateRule(ctx, rule);
    } catch (error) {
      logger.warn({ err: error, ruleId: rule.id }, 'Alert rule evaluation failed');
    }
  }
}

/** Current reading for every rule, so the dashboard can show live values. */
async function currentRuleStatuses(rules: DbAlertRule[]): Promise<AlertRuleStatus[]> {
  if (!rules.length) return [];
  const ctx = await buildEvalContext();
  const statuses: AlertRuleStatus[] = [];
  for (const rule of rules) {
    const value = await resolveValue(ctx, rule);
    statuses.push({
      ruleId: rule.id,
      value: value === null ? null : round(value),
      breaching: value === null ? null : compareValue(value, rule.operator, rule.threshold),
    });
  }
  return statuses;
}

/** Map a Discord delivery outcome to the dashboard's test response. */
function testOutcome(
  outcome: Awaited<ReturnType<typeof discordService.send>>,
): TestAlertResponse {
  if (outcome.status === 'skipped') {
    return {
      ok: false,
      status: 'skipped',
      message:
        'No Discord webhook is configured. Set DISCORD_WEBHOOK_URL on the API host to enable notifications.',
    };
  }
  if (outcome.status === 'failed') {
    return {
      ok: false,
      status: 'failed',
      message: outcome.errorSummary ?? 'Discord delivery failed.',
    };
  }
  return { ok: true, status: 'delivered', message: 'Test notification delivered to Discord.' };
}

async function setRuleMutedUntil(
  ruleId: string,
  mutedUntil: Date | null,
): Promise<AlertRule> {
  const existing = await alertRepository.getRule(ruleId);
  if (!existing) throw AppError.notFound('Alert rule not found');
  const updated = await alertRepository.updateRule(ruleId, { mutedUntil });
  ruleState.delete(ruleId);
  return toAlertRule(updated);
}

export const alertService = {
  async overview(): Promise<AlertsOverview> {
    const server = await getPrimaryServer();
    const [rules, incidents] = await Promise.all([
      alertRepository.listRules(server.id),
      alertRepository.listServerIncidents(server.id, 50),
    ]);
    return {
      rules: rules.map(toAlertRule),
      incidents: incidents.map(toAlertIncidentView),
      discordConfigured: isDiscordConfigured(),
      ruleStatus: await currentRuleStatuses(rules),
      evaluation: {
        intervalSeconds: ALERT_EVALUATION_INTERVAL_MS / 1000,
        triggerEvaluations: TRIGGER_CONSECUTIVE,
        resolveEvaluations: RESOLVE_CONSECUTIVE,
      },
    };
  },

  async createRule(input: {
    name: string;
    metric: string;
    operator: string;
    threshold: number;
    evaluationWindowSeconds: number;
    severity: string;
    cooldownSeconds: number;
    enabled: boolean;
    notifyDiscord: boolean;
  }): Promise<AlertRule> {
    const server = await getPrimaryServer();
    const rule = await alertRepository.createRule(server.id, input);
    return toAlertRule(rule);
  },

  async updateRule(
    id: string,
    patch: Partial<{
      name: string;
      metric: string;
      operator: string;
      threshold: number;
      evaluationWindowSeconds: number;
      severity: string;
      cooldownSeconds: number;
      enabled: boolean;
      notifyDiscord: boolean;
    }>,
  ): Promise<AlertRule> {
    const existing = await alertRepository.getRule(id);
    if (!existing) throw AppError.notFound('Alert rule not found');
    const updated = await alertRepository.updateRule(id, patch);
    // Metric/operator/threshold/window changes invalidate the streaks gathered
    // under the old condition; start clean instead of acting on stale counters.
    const conditionChanged =
      (patch.metric !== undefined && patch.metric !== existing.metric) ||
      (patch.operator !== undefined && patch.operator !== existing.operator) ||
      (patch.threshold !== undefined && patch.threshold !== existing.threshold) ||
      (patch.evaluationWindowSeconds !== undefined &&
        patch.evaluationWindowSeconds !== existing.evaluationWindowSeconds);
    if (conditionChanged) ruleState.delete(id);
    return toAlertRule(updated);
  },

  async deleteRule(id: string): Promise<void> {
    const existing = await alertRepository.getRule(id);
    if (!existing) throw AppError.notFound('Alert rule not found');
    await alertRepository.deleteRule(id);
    ruleState.delete(id);
  },

  async listIncidents(ruleId: string, limit = 20): Promise<AlertIncident[]> {
    const existing = await alertRepository.getRule(ruleId);
    if (!existing) throw AppError.notFound('Alert rule not found');
    const rows = await alertRepository.listIncidents(ruleId, limit);
    return rows.map(toAlertIncident);
  },

  async testRule(id: string): Promise<TestAlertResponse> {
    const rule = await alertRepository.getRule(id);
    if (!rule) throw AppError.notFound('Alert rule not found');

    const outcome = await discordService.send({
      title: `Test notification: ${rule.name}`,
      description: 'This is a MinePulse test notification. No incident was created.',
      color: severityColor(rule.severity),
      fields: [
        { name: 'Metric', value: rule.metric, inline: true },
        { name: 'Condition', value: `${rule.operator} ${rule.threshold}`, inline: true },
        { name: 'Severity', value: rule.severity, inline: true },
      ],
    });
    return testOutcome(outcome);
  },

  /** Generic channel test; uses a neutral payload instead of a rule. */
  async testDiscord(): Promise<TestAlertResponse> {
    const outcome = await discordService.send({
      title: 'Test notification: MinePulse',
      description: 'This is a MinePulse channel test. No incident was created.',
      color: 0x3b82f6,
      fields: [{ name: 'Channel', value: 'Discord', inline: true }],
    });
    return testOutcome(outcome);
  },

  async acknowledgeIncident(id: string): Promise<AlertIncident> {
    const incident = await alertRepository.getIncident(id);
    if (!incident) throw AppError.notFound('Alert incident not found');
    if (incident.status === 'resolved') throw AppError.conflict('Incident is already resolved');
    if (incident.status === 'acknowledged') return toAlertIncident(incident);
    const updated = await alertRepository.acknowledgeIncident(id);
    return toAlertIncident(updated);
  },

  /** Manually resolve an incident. The rule's cooldown still gates re-opening. */
  async resolveIncidentById(id: string): Promise<AlertIncident> {
    const incident = await alertRepository.getIncident(id);
    if (!incident) throw AppError.notFound('Alert incident not found');
    if (incident.status === 'resolved') return toAlertIncident(incident);
    const resolved = await alertRepository.resolveIncident(id, new Date());
    bus.publish('alert:resolved', {
      rule: toAlertRule(incident.alertRule),
      incident: toAlertIncident(resolved),
    });
    return toAlertIncident(resolved);
  },

  async deleteIncident(id: string): Promise<void> {
    const incident = await alertRepository.getIncident(id);
    if (!incident) throw AppError.notFound('Alert incident not found');
    await alertRepository.deleteIncident(id);
  },

  async snoozeRule(id: string, minutes: number): Promise<AlertRule> {
    return setRuleMutedUntil(id, new Date(Date.now() + minutes * 60_000));
  },

  async unmuteRule(id: string): Promise<AlertRule> {
    return setRuleMutedUntil(id, null);
  },

  /** Snooze from an incident: mute its rule and acknowledge the incident. */
  async snoozeIncident(
    id: string,
    minutes: number,
  ): Promise<{ incident: AlertIncident; rule: AlertRule }> {
    const incident = await alertRepository.getIncident(id);
    if (!incident) throw AppError.notFound('Alert incident not found');
    const rule = await setRuleMutedUntil(
      incident.alertRuleId,
      new Date(Date.now() + minutes * 60_000),
    );
    const updated =
      incident.status === 'resolved'
        ? incident
        : await alertRepository.acknowledgeIncident(incident.id);
    return { incident: toAlertIncident(updated), rule };
  },

  async acknowledgeAllIncidents(): Promise<number> {
    const server = await getPrimaryServer();
    return alertRepository.acknowledgeAll(server.id);
  },

  async resolveAllIncidents(): Promise<number> {
    const server = await getPrimaryServer();
    return alertRepository.resolveAll(server.id, new Date());
  },
};

export type { AlertIncidentView };
