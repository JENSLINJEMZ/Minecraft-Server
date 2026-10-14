import { Router } from 'express';
import { settingsPatchSchema } from '@minepulse/shared';
import { requireAdmin, requireCsrf, requireUser } from '../middleware/auth.js';
import { parseOrThrow } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPrimaryServer } from '../services/serverContext.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { eventRepository } from '../repositories/eventRepository.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { isDiscordConfigured } from '../services/discordService.js';
import { toSettings, toServerEvent } from '../services/dto.js';
import { bus } from '../realtime/bus.js';

export const settingsRouter = Router();

settingsRouter.use(requireUser);

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const server = await getPrimaryServer();
    const settings = await settingsRepository.get(server.id);
    res.json(toSettings(settings, isDiscordConfigured()));
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

    res.json(toSettings(updated, isDiscordConfigured()));
  }),
);
