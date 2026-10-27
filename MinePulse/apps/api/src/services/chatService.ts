import { chatRepository } from '../repositories/chatRepository.js';
import type { ChatMessage, ChatMessageQuery, ChatPage, ChatStats } from '@minepulse/shared';

/** Read service for the dashboard Chat page. */
export const chatService = {
  async page(
    serverId: string,
    params: ChatMessageQuery,
  ): Promise<ChatPage> {
    const { items, total, stats } = await this.list(serverId, params);
    return { items, page: params.page, pageSize: params.pageSize, total, stats };
  },

  async list(
    serverId: string,
    params: ChatMessageQuery,
  ): Promise<{ items: ChatMessage[]; total: number; stats: ChatStats }> {
    const [page, stats] = await Promise.all([
      chatRepository.list(serverId, params),
      chatRepository.stats(serverId),
    ]);
    return { items: page.items, total: page.total, stats };
  },
};
