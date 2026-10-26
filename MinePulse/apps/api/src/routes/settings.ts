import { Router } from 'express';
import {
  agentCredentialCreateSchema,
  settingsPatchSchema,
} from '@minepulse/shared';
import type { AgentCredential, SettingsSecurity } from '@minepulse/shared';
import { requireAdmin, requireCsrf, requireUser } from '../middleware/auth.js';
import { parseOrThrow } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPrimaryServer } from '../services/serverContext.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import {
  DEFAULT_SETTINGS,
  settingsRepository,
} from '../repositories/settingsRepository.js';
import { agentCredentialRepository } from '../repositories/agentCredentialRepository.js';
import { eventRepository } from '../repositories/eventRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { isDiscordConfigured } from '../services/discordService.js';
import { toSettings, toServerEvent } from '../services/dto.js';
import { bus } from '../realtime/bus.js';
import { runRetention } from '../jobs/retentionJob.js';
import {
  agentTokenPrefix,
  generateAgentToken,
  hashAgentToken,
} from '../security/agentToken.js';
import { AppError } from '../utils/errors.js';

export const settingsRouter = Router();

settingsRouter.use(requireUser);

const iso = (date: Date): string => date.toISOString();

function toCredential(row: {
  id: string;
  tokenPrefix: string;
  label: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): AgentCredential {
  return {
    id: row.id,
    tokenPrefix: row.tokenPrefix,
    label: row.label,
    lastUsedAt: row.lastUsedAt ? iso(row.lastUsedAt) : null,
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
    createdAt: iso(row.createdAt),
  };
}

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const server = await getPrimaryServer();
    const settings = await settingsRepository.get(server.id);
    res.json(toSettings(settings, isDiscordConfigured(), DEFAULT_SETTINGS));
  }),
);

/**
 * Everything the Security tab needs. Admin-only: it lists dashboard accounts
 * and agent credential prefixes, never a credential's raw token or hash.
 */
settingsRouter.get(
  '/security',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const [session, agentCredentials, team] = await Promise.all([
      prisma.session.findUnique({
        where: { id: req.session!.id },
        select: { createdAt: true, lastUsedAt: true, expiresAt: true },
      }),
      agentCredentialRepository.listForServer(server.id),
      prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, role: true, createdAt: true },
      }),
    ]);

    if (!session) throw AppError.unauthorized('Session not found');

    const body: SettingsSecurity = {
      session: {
        createdAt: iso(session.createdAt),
        lastUsedAt: iso(session.lastUsedAt),
        expiresAt: iso(session.expiresAt),
      },
      agentCredentials: agentCredentials.map(toCredential),
      team: team.map((member) => ({
        id: member.id,
        email: member.email,
        role: member.role === 'admin' ? 'admin' : 'viewer',
        createdAt: iso(member.createdAt),
      })),
      apiBind: env.API_BIND,
      sessionTtlSeconds: Math.max(
        0,
        Math.round((session.expiresAt.getTime() - session.createdAt.getTime()) / 1000),
      ),
    };

    res.json(body);
  }),
);

/** Create an agent credential. The raw token is returned exactly once. */
settingsRouter.post(
  '/agent-credentials',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(agentCredentialCreateSchema, req.body ?? {});
    const server = await getPrimaryServer();
    const token = generateAgentToken();
    const created = await agentCredentialRepository.create({
      serverId: server.id,
      tokenPrefix: agentTokenPrefix(token),
      tokenHash: hashAgentToken(token),
      label: input.label?.trim() || null,
    });

    await auditRepository.create({
      userId: req.user!.id,
      action: 'agent_credential.create',
      targetType: 'agent_credential',
      targetId: created.id,
      metadata: { label: created.label, tokenPrefix: created.tokenPrefix },
    });

    res.status(201).json({ ...toCredential(created), token });
  }),
);

settingsRouter.post(
  '/agent-credentials/:id/revoke',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const credential = await agentCredentialRepository.findById(req.params.id!);
    if (!credential || credential.serverId !== server.id) {
      throw AppError.notFound('Agent credential not found');
    }
    if (credential.revokedAt) {
      throw AppError.conflict('Agent credential is already revoked');
    }

    const revoked = await agentCredentialRepository.revoke(credential.id);
    await auditRepository.create({
      userId: req.user!.id,
      action: 'agent_credential.revoke',
      targetType: 'agent_credential',
      targetId: revoked.id,
      metadata: { label: revoked.label, tokenPrefix: revoked.tokenPrefix },
    });

    res.json(toCredential(revoked));
  }),
);

/** Run the retention sweep immediately and report what was removed. */
settingsRouter.post(
  '/retention/run',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const counts = await runRetention();
    await auditRepository.create({
      userId: req.user!.id,
      action: 'settings.retention_run',
      targetType: 'server_settings',
      metadata: { ...counts },
    });
    res.json(counts);
  }),
);

settingsRouter.patch(
  '/',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const server = await getPrimaryServer();
    const patch = parseOrThrow(settingsPatchSchema, req.body);
    const before = await settingsRepository.get(server.id);
    const nextStale = patch.heartbeatStaleSeconds ?? before.heartbeatStaleSeconds;
    const nextOffline = patch.heartbeatOfflineSeconds ?? before.heartbeatOfflineSeconds;
    if (nextOffline <= nextStale) {
      throw AppError.badRequest('Offline threshold must be greater than the stale threshold');
    }
    const updated = await settingsRepository.patch(server.id, patch);

    const changed = Object.keys(patch).filter(
      (key) => before[key as keyof typeof before] !== updated[key as keyof typeof updated],
    );

    await auditRepository.create({
      userId: req.user!.id,
      action: 'settings.update',
      targetType: 'server_settings',
      targetId: server.id,
      metadata: { changed, patch: patch as Record<string, unknown> },
    });

    // Record a searchable, realtime event for the change.
    if (changed.length > 0) {
      const { rows } = await eventRepository.createMany(
        server.id,
        [
          {
            type: 'setting_changed',
            severity: 'info',
            occurredAt: new Date().toISOString(),
            summary: `Settings updated: ${changed.join(', ')}`,
            details: patch as Record<string, unknown>,
          },
        ],
        `settings-${Date.now()}`,
      );
      for (const row of rows) bus.publish('event', toServerEvent(row));
    }

    res.json(toSettings(updated, isDiscordConfigured(), DEFAULT_SETTINGS));
  }),
);
