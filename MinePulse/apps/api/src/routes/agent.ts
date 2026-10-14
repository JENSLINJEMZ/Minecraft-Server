import { Router } from 'express';
import {
  SCHEMA_VERSION,
  agentActionResultSchema,
  eventsPayloadSchema,
  heartbeatPayloadSchema,
  metricsPayloadSchema,
  pluginsPayloadSchema,
} from '@minepulse/shared';
import { agentAuth } from '../middleware/agentAuth.js';
import { agentIngestRateLimit } from '../middleware/rateLimit.js';
import { parseOrThrow } from '../middleware/validate.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { moderationService } from '../services/moderationService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/errors.js';
import { requireServerById } from '../services/serverContext.js';
import {
  ingestEvents,
  ingestHeartbeat,
  ingestMetrics,
  ingestPlugins,
} from '../services/telemetryService.js';
import { resolveStatus } from '../services/statusService.js';

export const agentRouter = Router();

// Agent auth is strictly separate from browser sessions.
agentRouter.use(agentAuth);
agentRouter.use(agentIngestRateLimit);

/**
 * Identity/context handshake. An agent with a valid token can discover the
 * serverId its credential is bound to, so it never needs it hardcoded.
 */
agentRouter.get(
  '/context',
  asyncHandler(async (req, res) => {
    const server = await requireServerById(req.agent!.serverId);
    const [status, settings] = await Promise.all([
      resolveStatus(server),
      settingsRepository.get(server.id),
    ]);
    res.json({
      schemaVersion: SCHEMA_VERSION,
      serverId: server.id,
      serverName: server.name,
      serverState: status.state,
      heartbeatStaleSeconds: settings.heartbeatStaleSeconds,
      heartbeatOfflineSeconds: settings.heartbeatOfflineSeconds,
    });
  }),
);

function assertServerMatches(bodyServerId: string, credentialServerId: string): void {
  if (bodyServerId !== credentialServerId) {
    throw AppError.forbidden('Payload serverId does not match agent credential');
  }
}

agentRouter.post(
  '/heartbeat',
  asyncHandler(async (req, res) => {
    const payload = parseOrThrow(heartbeatPayloadSchema, req.body);
    assertServerMatches(payload.serverId, req.agent!.serverId);
    const server = await requireServerById(req.agent!.serverId);

    const { duplicate } = await ingestHeartbeat(server, payload);
    const status = await resolveStatus(server);

    res.json({
      accepted: true,
      receivedAt: new Date().toISOString(),
      serverState: status.state,
      duplicate,
    });
  }),
);

agentRouter.post(
  '/metrics',
  asyncHandler(async (req, res) => {
    const payload = parseOrThrow(metricsPayloadSchema, req.body);
    assertServerMatches(payload.serverId, req.agent!.serverId);
    const server = await requireServerById(req.agent!.serverId);

    await ingestMetrics(server, payload);
    const status = await resolveStatus(server);

    res.json({
      accepted: true,
      receivedAt: new Date().toISOString(),
      serverState: status.state,
    });
  }),
);

agentRouter.post(
  '/events',
  asyncHandler(async (req, res) => {
    const payload = parseOrThrow(eventsPayloadSchema, req.body);
    assertServerMatches(payload.serverId, req.agent!.serverId);
    const server = await requireServerById(req.agent!.serverId);

    const stored = await ingestEvents(server, payload);
    const status = await resolveStatus(server);

    res.json({
      accepted: true,
      receivedAt: new Date().toISOString(),
      serverState: status.state,
      stored,
    });
  }),
);

agentRouter.post(
  '/plugins',
  asyncHandler(async (req, res) => {
    const payload = parseOrThrow(pluginsPayloadSchema, req.body);
    assertServerMatches(payload.serverId, req.agent!.serverId);
    const server = await requireServerById(req.agent!.serverId);

    await ingestPlugins(server, payload);
    const status = await resolveStatus(server);

    res.json({
      accepted: true,
      receivedAt: new Date().toISOString(),
      serverState: status.state,
    });
  }),
);

/**
 * Moderation channel. The agent has no inbound port, so it polls for queued
 * actions and reports their result. Actions are fixed verbs, never commands.
 */
agentRouter.get(
  '/actions',
  asyncHandler(async (req, res) => {
    const server = await requireServerById(req.agent!.serverId);

    // Recover actions the agent claimed but never reported (e.g. it restarted).
    await moderationRepository.requeueStuck(server.id, new Date(Date.now() - 60_000));
    const { actions, mutedUuids } = await moderationService.pendingForAgent(server.id);

    res.json({
      schemaVersion: SCHEMA_VERSION,
      serverId: server.id,
      actions,
      mutedUuids,
    });
  }),
);

agentRouter.post(
  '/actions/:id/result',
  asyncHandler(async (req, res) => {
    const server = await requireServerById(req.agent!.serverId);
    const result = parseOrThrow(agentActionResultSchema, req.body);
    const id = req.params.id!;
    const row = await moderationRepository.findById(id);
    if (!row || row.serverId !== server.id) {
      throw AppError.notFound('Unknown moderation action');
    }
    await moderationService.complete(id, result.ok, result.message ?? null);
    res.json({ accepted: true, completedAt: new Date().toISOString() });
  }),
);
