import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Backend-only Discord notifier.
 *
 * The webhook URL is read from the environment and is never returned to the
 * dashboard or written to logs. When it is not configured, deliveries are
 * reported as `skipped` so the UI can honestly show "not configured" instead of
 * pretending a notification was sent.
 */

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordMessage {
  title: string;
  description?: string;
  /** Decimal colour (0xRRGGBB). */
  color: number;
  fields?: DiscordField[];
}

export interface DeliveryOutcome {
  status: 'delivered' | 'failed' | 'skipped';
  attempts: number;
  errorSummary: string | null;
}

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 8000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function isDiscordConfigured(): boolean {
  return env.DISCORD_WEBHOOK_URL.trim().length > 0;
}

async function postOnce(url: string, payload: unknown): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, detail: '' };
    const text = await res.text().catch(() => '');
    return { ok: false, detail: `Discord responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}

export const discordService = {
  isConfigured: isDiscordConfigured,

  /** POST an embed with bounded retries. Never throws. */
  async send(message: DiscordMessage): Promise<DeliveryOutcome> {
    const url = env.DISCORD_WEBHOOK_URL.trim();
    if (!url) {
      return { status: 'skipped', attempts: 0, errorSummary: null };
    }

    const payload = {
      embeds: [
        {
          title: message.title,
          description: message.description,
          color: message.color,
          fields: message.fields,
          timestamp: new Date().toISOString(),
          footer: { text: 'MinePulse' },
        },
      ],
    };

    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await postOnce(url, payload);
      if (result.ok) {
        return { status: 'delivered', attempts: attempt, errorSummary: null };
      }
      lastError = result.detail;
      // Do not retry deterministic client errors (bad payload / revoked hook).
      if (/\b(400|401|403|404|405)\b/.test(result.detail)) break;
      if (attempt < MAX_ATTEMPTS) await delay(400 * attempt);
    }

    logger.warn({ errorSummary: lastError }, 'Discord delivery failed');
    return { status: 'failed', attempts: MAX_ATTEMPTS, errorSummary: lastError };
  },
};
