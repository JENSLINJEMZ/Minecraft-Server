import { Router } from 'express';
import { alertRuleInputSchema, alertRulePatchSchema } from '@minepulse/shared';
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
