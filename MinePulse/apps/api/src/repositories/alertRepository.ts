import { prisma } from '../lib/prisma.js';

export const alertRepository = {
  listRules(serverId: string) {
    return prisma.alertRule.findMany({ where: { serverId }, orderBy: { createdAt: 'asc' } });
  },

  getRule(id: string) {
    return prisma.alertRule.findUnique({ where: { id } });
  },

  createRule(
    serverId: string,
    data: {
      name: string;
      metric: string;
      operator: string;
      threshold: number;
      evaluationWindowSeconds: number;
      severity: string;
      cooldownSeconds: number;
      enabled: boolean;
    },
  ) {
    return prisma.alertRule.create({ data: { serverId, ...data } });
  },

  updateRule(
    id: string,
    data: Partial<{
      name: string;
      metric: string;
      operator: string;
      threshold: number;
      evaluationWindowSeconds: number;
      severity: string;
      cooldownSeconds: number;
      enabled: boolean;
      lastTriggeredAt: Date | null;
      lastDeliveryStatus: string;
    }>,
  ) {
    return prisma.alertRule.update({ where: { id }, data });
  },

  deleteRule(id: string) {
    return prisma.alertRule.delete({ where: { id } });
  },

  findOpenIncident(ruleId: string) {
    return prisma.alertIncident.findFirst({
      where: { alertRuleId: ruleId, status: 'open' },
      orderBy: { startedAt: 'desc' },
    });
  },

  openIncident(ruleId: string, triggerValue: number | null, summary: string) {
    return prisma.alertIncident.create({
      data: { alertRuleId: ruleId, status: 'open', triggerValue, summary },
    });
  },

  resolveIncident(id: string, at: Date) {
    return prisma.alertIncident.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: at },
    });
  },

  markIncidentNotified(id: string, at: Date) {
    return prisma.alertIncident.update({ where: { id }, data: { lastNotifiedAt: at } });
  },

  listIncidents(ruleId: string, limit = 20) {
    return prisma.alertIncident.findMany({
      where: { alertRuleId: ruleId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
  },

  countIncidentsSince(ruleId: string, since: Date) {
    return prisma.alertIncident.count({
      where: { alertRuleId: ruleId, startedAt: { gte: since } },
    });
  },

  /** All incidents for a server (joined through the rule), newest first. */
  listServerIncidents(serverId: string, limit = 50) {
    return prisma.alertIncident.findMany({
      where: { alertRule: { serverId } },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { alertRule: true },
    });
  },

  createDelivery(input: {
    alertIncidentId: string;
    channel: string;
    status: string;
    attemptCount: number;
    deliveredAt: Date | null;
    errorSummary: string | null;
  }) {
    return prisma.notificationDelivery.create({ data: input });
  },
};
