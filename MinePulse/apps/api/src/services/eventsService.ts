import { eventRepository } from '../repositories/eventRepository.js';
import { toServerEvent } from './dto.js';
import type { ServerEvent } from '@minepulse/shared';

export const eventsService = {
  async list(
    serverId: string,
    params: {
      severity?: string;
      category?: string;
      from?: Date;
      to?: Date;
      search?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: ServerEvent[]; total: number }> {
    const { items, total } = await eventRepository.list({ serverId, ...params });
    return { items: items.map(toServerEvent), total };
  },

  async recent(serverId: string, limit = 20): Promise<ServerEvent[]> {
    const rows = await eventRepository.recent(serverId, limit);
    return rows.map(toServerEvent);
  },

  /** Unpaginated (but bounded) list used by the CSV export endpoint. */
  async exportList(
    serverId: string,
    params: {
      severity?: string;
      category?: string;
      from?: Date;
      to?: Date;
      search?: string;
      max?: number;
    },
  ): Promise<ServerEvent[]> {
    const rows = await eventRepository.listForExport({ serverId, ...params });
    return rows.map(toServerEvent);
  },
};
