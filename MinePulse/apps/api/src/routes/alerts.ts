import { Router } from 'express';
import {
  alertRuleInputSchema,
  alertRulePatchSchema,
  alertSnoozeInputSchema,
} from '@minepulse/shared';
import { requireAdmin, requireCsrf, requireUser } from '../middleware/auth.js';
import { parseOrThrow } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { alertService } from '../services/alertService.js';
import { auditRepository } from '../repositories/auditRepository.js';

export const alertsRouter = Router();

// Reads require an authenticated user; mutations additionally require admin + CSRF.
alertsRouter.use(requireUser);

alertsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await alertService.overview());
  }),
);

// Incident actions. Specific paths are registered before the generic /:id
// routes so "acknowledge-all" can never be mistaken for a rule id.
alertsRouter.post(
  '/incidents/acknowledge-all',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const count = await alertService.acknowledgeAllIncidents();
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_incident.acknowledge_all',
      targetType: 'alert_incident',
      metadata: { count },
    });
    res.json({ count });
  }),
);

alertsRouter.post(
  '/incidents/resolve-all',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const count = await alertService.resolveAllIncidents();
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_incident.resolve_all',
      targetType: 'alert_incident',
      metadata: { count },
    });
    res.json({ count });
  }),
);

alertsRouter.post(
  '/incidents/:id/acknowledge',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const incident = await alertService.acknowledgeIncident(req.params.id!);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_incident.acknowledge',
      targetType: 'alert_incident',
      targetId: incident.id,
      metadata: { alertRuleId: incident.alertRuleId },
    });
    res.json(incident);
  }),
);

alertsRouter.post(
  '/incidents/:id/resolve',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const incident = await alertService.resolveIncidentById(req.params.id!);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_incident.resolve',
      targetType: 'alert_incident',
      targetId: incident.id,
      metadata: { alertRuleId: incident.alertRuleId },
    });
    res.json(incident);
  }),
);

alertsRouter.post(
  '/incidents/:id/snooze',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(alertSnoozeInputSchema, req.body ?? {});
    const result = await alertService.snoozeIncident(req.params.id!, input.minutes);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_incident.snooze',
      targetType: 'alert_incident',
      targetId: result.incident.id,
      metadata: { minutes: input.minutes, alertRuleId: result.incident.alertRuleId },
    });
    res.json(result);
  }),
);

alertsRouter.delete(
  '/incidents/:id',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    await alertService.deleteIncident(id);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_incident.delete',
      targetType: 'alert_incident',
      targetId: id,
    });
    res.status(204).end();
  }),
);

// Channel test. Does not create an incident and is independent of any rule.
alertsRouter.post(
  '/channels/discord/test',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const result = await alertService.testDiscord();
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_channel.test',
      targetType: 'alert_channel',
      targetId: 'discord',
      metadata: { status: result.status },
    });
    res.json(result);
  }),
);

alertsRouter.post(
  '/',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(alertRuleInputSchema, req.body);
    const rule = await alertService.createRule(input);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_rule.create',
      targetType: 'alert_rule',
      targetId: rule.id,
      metadata: { name: rule.name, metric: rule.metric, operator: rule.operator, threshold: rule.threshold },
    });
    res.status(201).json(rule);
  }),
);

alertsRouter.patch(
  '/:id',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const patch = parseOrThrow(alertRulePatchSchema, req.body);
    const rule = await alertService.updateRule(req.params.id!, patch);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_rule.update',
      targetType: 'alert_rule',
      targetId: rule.id,
      metadata: patch as Record<string, unknown>,
    });
    res.json(rule);
  }),
);

// Mute/unmute a rule without touching its incidents.
alertsRouter.post(
  '/:id/snooze',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(alertSnoozeInputSchema, req.body ?? {});
    const rule = await alertService.snoozeRule(req.params.id!, input.minutes);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_rule.snooze',
      targetType: 'alert_rule',
      targetId: rule.id,
      metadata: { minutes: input.minutes },
    });
    res.json(rule);
  }),
);

alertsRouter.post(
  '/:id/unmute',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const rule = await alertService.unmuteRule(req.params.id!);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_rule.unmute',
      targetType: 'alert_rule',
      targetId: rule.id,
    });
    res.json(rule);
  }),
);

alertsRouter.delete(
  '/:id',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    await alertService.deleteRule(id);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'alert_rule.delete',
      targetType: 'alert_rule',
      targetId: id,
    });
    res.status(204).end();
  }),
);

alertsRouter.post(
  '/:id/test',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    res.json(await alertService.testRule(req.params.id!));
  }),
);

alertsRouter.get(
  '/:id/incidents',
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(await alertService.listIncidents(req.params.id!, limit));
  }),
);
