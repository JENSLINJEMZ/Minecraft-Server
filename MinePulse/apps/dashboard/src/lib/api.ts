/** Typed fetch client for the MinePulse API. */

/**
 * Resolve the API base URL.
 *
 * The dashboard must talk to the API on the *same hostname* the page was
 * opened with. `localhost` and `127.0.0.1` are different sites for cookie
 * purposes, so mixing them makes the session cookie cross-site and it is never
 * sent with fetches — login appears to work, then every request is anonymous.
 */
function resolveApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://127.0.0.1:4000';
  const host = window.location.hostname || '127.0.0.1';
  return `${window.location.protocol}//${host}:4000`;
}

const API_BASE = resolveApiBase();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken) headers['x-csrf-token'] = csrfToken;

  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Download an authenticated file (CSV export) with the session cookie and
 * trigger a browser save. Uses fetch rather than window.open so cookies and
 * error handling behave the same as every other API call.
 */
export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new ApiError(res.status, 'export_failed', `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export { API_BASE };
