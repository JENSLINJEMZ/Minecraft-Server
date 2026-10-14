/** Small formatting + math helpers shared by every page. */

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Only allow http(s) URLs to reach an href attribute. */
export const safeUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
};

export const num = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toLocaleString());

export const pct = (value) =>
  value == null || Number.isNaN(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}%`;

export const fixed = (value, digits = 2) =>
  value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits);

export const tps = (value) => fixed(value, 2);

export const mspt = (value) => (value == null ? '—' : `${fixed(value, 1)} ms`);

/** Human readable byte size (binary units). */
export const bytes = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(value);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
};

export const gigabytes = (value) =>
  value == null || Number.isNaN(Number(value)) ? '—' : `${(Number(value) / 1024 / 1024 / 1024).toFixed(2)} GB`;

/** Compact duration from seconds, e.g. "3d 14h" / "2h 14m" / "45s". */
export const duration = (seconds) => {
  if (seconds == null || Number.isNaN(Number(seconds))) return '—';
  let s = Math.max(0, Math.floor(Number(seconds)));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
};

export const uptimeText = (seconds) => {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.floor(Number(seconds)));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
};

/** Relative "time ago" from an ISO string or epoch-ms. */
export const ago = (input) => {
  if (input == null) return '—';
  const ms = typeof input === 'number' ? Date.now() - input : Date.now() - new Date(input).getTime();
  if (Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(input).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const clock = (input) => {
  if (!input) return '—';
  const d = new Date(input);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const timeSeconds = (input) => {
  if (!input) return '—';
  const d = new Date(input);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const dateTime = (input) => {
  if (!input) return '—';
  return new Date(input).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const dateOnly = (input) => {
  if (!input) return '—';
  return new Date(input).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const compactDate = (input) => {
  if (!input) return '—';
  const d = new Date(input);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/* ---------- numeric series helpers (skip nulls) ---------- */
const clean = (arr) => arr.filter((v) => v != null && !Number.isNaN(Number(v))).map(Number);

export const seriesAvg = (arr) => {
  const a = clean(arr);
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
};

export const seriesLast = (arr) => {
  for (let i = arr.length - 1; i >= 0; i -= 1) if (arr[i] != null) return Number(arr[i]);
  return null;
};

export const seriesMax = (arr) => {
  const a = clean(arr);
  return a.length ? Math.max(...a) : null;
};

export const seriesMin = (arr) => {
  const a = clean(arr);
  return a.length ? Math.min(...a) : null;
};

export const percentile = (arr, p) => {
  const a = clean(arr).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
};

/** Build an SVG polyline path across a fixed viewBox, clamping into [min,max]. */
export function sparkPath(values, min, max, width = 300, height = 100) {
  const points = values.map((v) => (v == null ? null : Number(v)));
  const idx = points.map((v, i) => (v == null ? null : i)).filter((v) => v != null);
  if (!idx.length) return '';
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  let started = false;
  return points
    .map((v, i) => {
      if (v == null) return '';
      const x = (i * step).toFixed(1);
      const y = (height - clamp((v - min) / span, 0, 1) * height).toFixed(1);
      const cmd = started ? 'L' : 'M';
      started = true;
      return `${cmd}${x},${y}`;
    })
    .filter(Boolean)
    .join('');
}

export const SERVER_STATE_TONE = {
  online: 'g',
  degraded: 'y',
  stale: 'y',
  offline: 'r',
};

export const SEVERITY_TONE = {
  info: 'i',
  warning: 'w',
  critical: 'c',
};
