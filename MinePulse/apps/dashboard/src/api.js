/**
 * Fetch client for the MinePulse API.
 *
 * The dashboard and API must share a hostname (localhost vs 127.0.0.1 are
 * different cookie sites), so the base URL is derived from `location.hostname`
 * exactly like the original React client did.
 */
const fromEnv = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : undefined;

export const API_BASE =
  (fromEnv && String(fromEnv).replace(/\/$/, '')) ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname || '127.0.0.1'}:4000`
    : 'http://127.0.0.1:4000');

let csrfToken = '';

export const setCsrfToken = (value) => {
  csrfToken = value || '';
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const err = body && body.error ? body.error : {};
    throw new ApiError(response.status, err.code || 'error', err.message || response.statusText);
  }
  return body;
}

export async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  return parse(response);
}

/** Like apiGet, but also returns the HTTP status for connection diagnostics. */
export async function apiProbe(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  return { status: response.status, body: await parse(response) };
}

export async function apiSend(method, path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse(response);
}

/** Trigger an authenticated browser download for a CSV endpoint. */
export async function apiDownload(path, filename) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, 'download_failed', 'Export failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const buildQuery = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};
