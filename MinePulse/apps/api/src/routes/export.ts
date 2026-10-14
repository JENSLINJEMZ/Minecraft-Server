import { Router } from 'express';
import { eventQuerySchema, metricHistoryQuerySchema } from '@minepulse/shared';
import { requireUser } from '../middleware/auth.js';
import { parseOrThrow } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCsv } from '../utils/csv.js';
import { getPrimaryServer } from '../services/serverContext.js';
import { metricsService } from '../services/metricsService.js';
import { eventsService } from '../services/eventsService.js';

/** Authorized CSV downloads (bounded so a single request cannot exhaust memory). */
const EVENT_EXPORT_LIMIT = 20_000;

export const exportRouter = Router();

exportRouter.use(requireUser);

exportRouter.get(
  '/metrics',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const q = parseOrThrow(metricHistoryQuerySchema, req.query);
    const history = await metricsService.getHistory(server, q.range);

    const headers = [
      'recordedAt',
      'tps1m',
      'tps5m',
      'tps15m',
      'mspt',
      'heapUsedBytes',
      'heapMaxBytes',
      'playerCount',
      'cpuUsagePercent',
    ];
    const rows = history.points.map((p) => [
      p.recordedAt,
      p.tps1m,
      p.tps5m,
      p.tps15m,
      p.mspt,
      p.heapUsedBytes,
      p.heapMaxBytes,
      p.playerCount,
      p.cpuUsagePercent,
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="minepulse-metrics-${q.range}.csv"`,
    );
    res.send(toCsv(headers, rows));
  }),
);

exportRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const q = parseOrThrow(eventQuerySchema, req.query);
    const items = await eventsService.exportList(server.id, {
      severity: q.severity,
      category: q.category,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      search: q.search,
      max: EVENT_EXPORT_LIMIT,
    });

    const headers = [
      'id',
      'occurredAt',
      'receivedAt',
      'eventType',
      'severity',
      'summary',
      'details',
      'requestId',
    ];
    const rows = items.map((e) => [
      e.id,
      e.occurredAt,
      e.receivedAt,
      e.eventType,
      e.severity,
      e.summary,
      e.details,
      e.requestId,
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="minepulse-events.csv"');
    res.send(toCsv(headers, rows));
  }),
);
