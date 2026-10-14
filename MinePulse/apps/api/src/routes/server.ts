import { Router } from 'express';
import {
  broadcastRequestSchema,
  eventQuerySchema,
  noteInputSchema,
  paginate,
  playerActionRequestSchema,
  playerQuerySchema,
  pluginActionRequestSchema,
  metricHistoryQuerySchema,
} from '@minepulse/shared';
import { requireAdmin, requireCsrf, requireUser } from '../middleware/auth.js';
import { parseOrThrow } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPrimaryServer } from '../services/serverContext.js';
import { resolveStatus } from '../services/statusService.js';
import { metricRepository } from '../repositories/metricRepository.js';
import { heartbeatRepository } from '../repositories/heartbeatRepository.js';
import { toCurrentMetrics, toServerInfo } from '../services/dto.js';
import { metricsService } from '../services/metricsService.js';
import { eventsService } from '../services/eventsService.js';
import { pluginsService } from '../services/pluginsService.js';
import { playersService } from '../services/playersService.js';
import { moderationService } from '../services/moderationService.js';
import { AppError } from '../utils/errors.js';

export const serverRouter = Router();

// All read endpoints require an authenticated dashboard user.
serverRouter.use(requireUser);

serverRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const server = await getPrimaryServer();
    res.json(toServerInfo(server));
  }),
);

serverRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const server = await getPrimaryServer();
    const status = await resolveStatus(server);
    res.json(status.dto);
  }),
);

serverRouter.get(
  '/metrics/current',
  asyncHandler(async (_req, res) => {
    const server = await getPrimaryServer();
    const [heartbeat, sample] = await Promise.all([
      heartbeatRepository.latest(server.id),
      metricRepository.latest(server.id),
    ]);
    res.json(toCurrentMetrics(server, heartbeat, sample));
  }),
);

serverRouter.get(
  '/metrics/history',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const { range } = parseOrThrow(metricHistoryQuerySchema, req.query);
    res.json(await metricsService.getHistory(server, range));
  }),
);

serverRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const q = parseOrThrow(eventQuerySchema, req.query);
    const { items, total } = await eventsService.list(server.id, {
      severity: q.severity,
      category: q.category,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      search: q.search,
      page: q.page,
      pageSize: q.pageSize,
    });
    res.json(paginate(items, q.page, q.pageSize, total));
  }),
);

serverRouter.get(
  '/events/recent',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(await eventsService.recent(server.id, limit));
  }),
);

serverRouter.get(
  '/plugins',
  asyncHandler(async (_req, res) => {
    const server = await getPrimaryServer();
    res.json(await pluginsService.latest(server.id));
  }),
);

serverRouter.get(
  '/plugins/history',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(await pluginsService.history(server.id, limit));
  }),
);

serverRouter.post(
  '/plugins/:name/action',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const body = parseOrThrow(pluginActionRequestSchema, req.body);
    const name = req.params.name!;
    // Only plugins the agent has actually reported may be targeted, and the
    // canonical casing comes from the inventory.
    const snapshot = await pluginsService.latest(server.id);
    const plugin = snapshot?.plugins.find(
      (p) => p.pluginName.toLowerCase() === name.toLowerCase(),
    );
    if (!plugin) throw AppError.notFound('Plugin not found in the latest inventory');

    const action = await moderationService.pluginAction(
      server.id,
      plugin.pluginName,
      body,
      req.user ? { id: req.user.id, email: req.user.email } : null,
    );
    res.json({ ok: true, action });
  }),
);

serverRouter.get(
  '/players',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const q = parseOrThrow(playerQuerySchema, req.query);
    const onlineOnly = req.query.onlineOnly === 'true';
    const { items, total } = await playersService.list(server.id, {
      search: q.search,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      onlineOnly,
      page: q.page,
      pageSize: q.pageSize,
    });
    res.json(paginate(items, q.page, q.pageSize, total));
  }),
);

serverRouter.get(
  '/players/analytics',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const hours = Math.min(24 * 90, Math.max(1, Number(req.query.hours) || 24));
    res.json(await playersService.analytics(server.id, hours));
  }),
);

serverRouter.get(
  '/players/:uuid',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    res.json(await playersService.get(server.id, req.params.uuid!));
  }),
);

serverRouter.get(
  '/players/:uuid/sessions',
  asyncHandler(async (req, res) => {
    await getPrimaryServer();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
    const { items, total } = await playersService.sessions(req.params.uuid!, page, pageSize);
    res.json(paginate(items, page, pageSize, total));
  }),
);

serverRouter.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const points = await playersService.activity(server.id, days);
    res.json({ serverId: server.id, points });
  }),
);

/* --- player profile + moderation ---------------------------------------- */

serverRouter.get(
  '/players/:uuid/activity',
  asyncHandler(async (req, res) => {
    await getPrimaryServer();
    const days = Math.min(180, Math.max(1, Number(req.query.days) || 14));
    const activity = await playersService.dailyActivity(req.params.uuid!, days);
    res.json({ uuid: req.params.uuid, days: activity });
  }),
);

serverRouter.get(
  '/players/:uuid/deaths',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    res.json(await playersService.deathsByCause(server.id, req.params.uuid!, days));
  }),
);

serverRouter.post(
  '/players/:uuid/action',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const body = parseOrThrow(playerActionRequestSchema, req.body);
    const player = await playersService.buildSummary(req.params.uuid!, server.id);
    if (!player) throw AppError.notFound('Player not found');

    const action = await moderationService.playerAction(
      server.id,
      { uuid: player.uuid, name: player.lastKnownUsername },
      body,
      req.user ? { id: req.user.id, email: req.user.email } : null,
    );
    const muted =
      body.action === 'mute' ? true : body.action === 'unmute' ? false : undefined;
    res.json({ ok: true, action, muted });
  }),
);

serverRouter.post(
  '/players/:uuid/notes',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const input = parseOrThrow(noteInputSchema, req.body);
    const player = await playersService.buildSummary(req.params.uuid!, server.id);
    if (!player) throw AppError.notFound('Player not found');
    const note = await moderationService.addNote(
      server.id,
      player.uuid,
      input.kind,
      input.body,
      req.user!.email,
    );
    res.json(note);
  }),
);

serverRouter.post(
  '/broadcast',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const { message } = parseOrThrow(broadcastRequestSchema, req.body);
    const action = await moderationService.broadcast(
      server.id,
      message,
      req.user ? { id: req.user.id, email: req.user.email } : null,
    );
    res.json({ ok: true, action });
  }),
);

serverRouter.get(
  '/actions',
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const playerUuid = typeof req.query.playerUuid === 'string' ? req.query.playerUuid : undefined;
    res.json({ items: await moderationService.list(server.id, limit, playerUuid) });
  }),
);
