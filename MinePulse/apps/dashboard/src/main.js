/**
 * MinePulse dashboard runtime.
 *
 * Vanilla-JS rewrite of the original dashboard design. It keeps the exact
 * stylesheet (`src/theme.css`) but replaces every piece of simulated data with
 * live reads from the MinePulse API plus the Socket.IO stream.
 */
import { io } from 'socket.io-client';
import {
  ApiError,
  API_BASE,
  apiDownload,
  apiGet,
  apiSend,
  buildQuery,
  setCsrfToken,
} from './api.js';
import { ICONS, ic } from './icons.js';
import * as F from './format.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const h = F.esc;

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const NAV = [
  ['home', 'Overview', 'overview'],
  ['chart', 'Performance', 'performance'],
  ['users', 'Players', 'players'],
  ['plug', 'Plugins', 'plugins'],
  ['doc', 'Events & Logs', 'events'],
  ['bell', 'Alerts', 'alerts'],
  ['gear', 'Settings', 'settings'],
];

const RANGES = ['15m', '1h', '6h', '24h', '7d'];

const PALETTE = ['#c2703d', '#cf3a3a', '#6f5bd6', '#3a8f5a', '#e9a23b', '#38bdf8', '#a855f7'];

const METRICS = [
  ['heartbeat_missing', 'Heartbeat missing (s)'],
  ['agent_disconnected', 'Agent disconnected (s)'],
  ['tps', 'TPS (1m)'],
  ['mspt', 'MSPT (ms)'],
  ['heap_percent', 'Heap used (%)'],
  ['player_count', 'Player count'],
  ['repeated_incidents', 'Repeated incidents (count)'],
];

const OPERATORS = [
  ['lt', '<'],
  ['lte', '≤'],
  ['gt', '>'],
  ['gte', '≥'],
  ['eq', '='],
];

const EVENT_CATEGORIES = [
  'server_started',
  'server_stopped',
  'agent_connected',
  'agent_disconnected',
  'heartbeat_missed',
  'heartbeat_restored',
  'player_joined',
  'player_left',
  'plugins_changed',
  'performance_warning',
  'performance_resolved',
  'memory_threshold_exceeded',
  'alert_delivered',
  'alert_delivery_failed',
  'setting_changed',
];

const EVENT_ICON = {
  server_started: 'server',
  server_stopped: 'server',
  agent_connected: 'link',
  agent_disconnected: 'link',
  heartbeat_missed: 'clock',
  heartbeat_restored: 'check',
  player_joined: 'users',
  player_left: 'users',
  plugins_changed: 'plug',
  performance_warning: 'alert',
  performance_resolved: 'check',
  memory_threshold_exceeded: 'memory',
  alert_delivered: 'bell',
  alert_delivery_failed: 'alert',
  setting_changed: 'gear',
};

const EVENT_TONE = { info: '#1f9d55', warning: '#f5b82e', critical: '#ef4444' };

const API = {
  server: '/api/v1/server',
  status: '/api/v1/server/status',
  metrics: '/api/v1/server/metrics/current',
  history: (range) => `/api/v1/server/metrics/history?range=${range}`,
  plugins: '/api/v1/server/plugins',
  eventsRecent: (limit) => `/api/v1/server/events/recent?limit=${limit}`,
  events: (query) => `/api/v1/server/events${buildQuery(query)}`,
  players: (query) => `/api/v1/server/players${buildQuery(query)}`,
  playersAnalytics: (hours) => `/api/v1/server/players/analytics?hours=${hours}`,
  player: (uuid) => `/api/v1/server/players/${encodeURIComponent(uuid)}`,
  sessions: (uuid, query) => `/api/v1/server/players/${encodeURIComponent(uuid)}/sessions${buildQuery(query)}`,
  playerActivity: (uuid, days) =>
    `/api/v1/server/players/${encodeURIComponent(uuid)}/activity?days=${days}`,
  playerDeaths: (uuid, days) => `/api/v1/server/players/${encodeURIComponent(uuid)}/deaths?days=${days}`,
  playerAction: (uuid) => `/api/v1/server/players/${encodeURIComponent(uuid)}/action`,
  playerNotes: (uuid) => `/api/v1/server/players/${encodeURIComponent(uuid)}/notes`,
  actions: (query) => `/api/v1/server/actions${buildQuery(query)}`,
  broadcast: '/api/v1/server/broadcast',
  activity: (days) => `/api/v1/server/activity?days=${days}`,
  alerts: '/api/v1/alerts',
  settings: '/api/v1/settings',
};

const SOCKET = {
  status: 'server:status',
  metrics: 'server:metrics',
  players: 'server:players',
  plugins: 'server:plugins',
  event: 'server:event',
  action: 'server:action',
  alertTriggered: 'alert:triggered',
  alertResolved: 'alert:resolved',
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const state = {
  user: null,
  server: null,
  status: null,
  metrics: null,
  history: {},
  history24: null,
  plugins: null,
  eventsRecent: [],
  playersOnline: [],
  playersAll: [],
  playersRosterTotal: 0,
  playersAnalytics: null,
  activity: null,
  alerts: { rules: [], incidents: [], discordConfigured: false },
  settings: null,
  playersPage: null,
  eventsPage: null,
  socketConnected: false,
  loadedAt: 0,
};

const ui = {
  page: 'overview',
  range: '15m',
  ovPlayersTab: 'online',
  players: {
    search: '',
    tab: 'online',
    page: 1,
    pageSize: 25,
    status: 'all',
    world: 'all',
    sort: 'recent',
    seen: 'any',
    selected: {},
  },
  profile: {
    uuid: null,
    reason: '',
    message: '',
    broadcast: '',
    note: '',
    gamemode: 'survival',
  },
  plugins: { search: '', filter: 'all', sort: 'name' },
  events: { search: '', severity: '', category: '', page: 1, pageSize: 25 },
  alerts: { tab: 'open' },
};

let socket = null;
let rerenderTimer = null;
/** Cached profile payload so live re-renders do not re-fetch on every tick. */
let profileData = null;

/* ------------------------------------------------------------------ *
 * Small UI primitives
 * ------------------------------------------------------------------ */

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2800);
}

function modal(html) {
  let root = $('#md');
  if (!root) {
    root = document.createElement('div');
    root.id = 'md';
    document.body.append(root);
  }
  root.innerHTML = `<div class="mb"><div class="mc2">${html}</div></div>`;
  root.querySelector('.mb').addEventListener('click', (event) => {
    if (event.target.classList.contains('mb')) closeModal();
  });
}

function closeModal() {
  const root = $('#md');
  if (root) root.innerHTML = '';
}

const kpi = (label, value) => `<div class="card"><small>${label}</small><b>${value}</b></div>`;

const rows = (list) =>
  list.map(([label, value]) => `<div class="kv"><span>${label}</span><span>${value}</span></div>`).join('');

function colorFor(uuid) {
  let hash = 0;
  const text = String(uuid || '');
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

const HEAD_SERVICE = 'https://mc-heads.net/avatar';

function headUrl(uuid, size = 64) {
  return `${HEAD_SERVICE}/${encodeURIComponent(uuid)}/${Math.round(size)}`;
}

/**
 * Player head avatar. Loads the real Minecraft skin head by UUID and falls
 * back to a deterministic coloured tile if the image cannot be fetched.
 */
function avatar(uuid, size = 16, radius = null, name = null) {
  const round = radius == null ? '' : `;border-radius:${radius}px`;
  const px = Math.max(32, size * 2);
  // Offline-mode servers mint name-based UUIDs that resolve to a default head,
  // so prefer the username (which maps to the real Minecraft skin), fall back
  // to the UUID, then to the deterministic coloured tile.
  const primary = name ? headUrl(name, px) : headUrl(uuid, px);
  const fallback = name ? ` data-fallback="${h(headUrl(uuid, px))}"` : '';
  return `<span class="pa mp-head" style="background:${colorFor(uuid)} !important;width:${size}px;height:${size}px${round}"><img src="${h(
    primary,
  )}"${fallback} alt="" loading="lazy" width="${size}" height="${size}" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.removeAttribute('data-fallback')}else{this.remove()}"></span>`;
}

function rangeTabs(id) {
  return `<div class="tabs" id="${id}">${RANGES.map(
    (r) => `<span data-r="${r}" class="${r === ui.range ? 'on' : ''}">${r}</span>`,
  ).join('')}</div>`;
}

function empty(message) {
  return `<div class="mp-empty">${h(message)}</div>`;
}

function selectHTML(id, options, selected) {
  return `<select class="in" id="${id}">${options
    .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`)
    .join('')}</select>`;
}

/* ------------------------------------------------------------------ *
 * Data loading
 * ------------------------------------------------------------------ */

async function loadCore() {
  const [server, status, metrics, plugins, eventsRecent, playersOnline, activity, alerts, settings] =
    await Promise.all([
      apiGet(API.server),
      apiGet(API.status),
      apiGet(API.metrics),
      apiGet(API.plugins),
      apiGet(API.eventsRecent(30)),
      apiGet(API.players({ onlineOnly: 'true', pageSize: 50 })),
      apiGet(API.activity(14)),
      apiGet(API.alerts),
      apiGet(API.settings),
    ]);
  state.server = server;
  state.status = status;
  state.metrics = metrics;
  state.plugins = plugins;
  state.eventsRecent = eventsRecent || [];
  state.playersOnline = playersOnline?.items || [];
  state.activity = activity;
  state.alerts = alerts || state.alerts;
  state.settings = settings;
  state.loadedAt = Date.now();
}

async function loadHistory(range) {
  const data = await apiGet(API.history(range));
  state.history[range] = data;
  if (range === '24h') state.history24 = data;
  return data;
}

async function loadHistory24() {
  if (state.history24) return;
  try {
    state.history24 = await apiGet(API.history('24h'));
  } catch {
    state.history24 = { points: [] };
  }
}

async function loadPlayersAll() {
  const data = await apiGet(API.players({ pageSize: 200 }));
  state.playersAll = data?.items || [];
  state.playersRosterTotal = data?.total ?? state.playersAll.length;
  return data;
}

async function loadPlayersAnalytics(hours = 24) {
  state.playersAnalytics = await apiGet(API.playersAnalytics(hours));
  return state.playersAnalytics;
}

async function loadEventsPage() {
  const { search, severity, category, page, pageSize } = ui.events;
  state.eventsPage = await apiGet(API.events({ search, severity, category, page, pageSize }));
  return state.eventsPage;
}

async function loadAlerts() {
  state.alerts = await apiGet(API.alerts);
}

/* ------------------------------------------------------------------ *
 * Overview rendering
 * ------------------------------------------------------------------ */

function serverStateTone() {
  const s = state.status?.state || 'offline';
  return { online: 'g', degraded: 'y', stale: 'y', offline: 'r' }[s] || 'r';
}

/** Best-known connect address: the live status wins, then the stored server record. */
function serverAddress() {
  return state.status?.address || state.server?.address || null;
}

/** Human display name for the signed-in user, derived from the email local part. */
function displayName(user) {
  const local = (user?.email || '').split('@')[0] || 'Admin';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Dashboard role label shown next to the account name. */
function roleLabel(role) {
  return role === 'admin' ? 'Owner' : 'Viewer';
}

/** Only admins may issue moderation actions; viewers get a read-only view. */
const isAdmin = () => state.user?.role === 'admin';

/** `disabled` attribute plus explanatory title when the caller lacks access. */
const disAttr = (blocked, reason = 'Admin access required') =>
  blocked ? ` disabled title="${reason}"` : '';

function healthScore() {
  const sample = state.metrics?.sample || {};
  const status = state.status || {};
  let score = 100;
  if (!status.agentConnected) score -= 60;
  else if (status.state === 'stale') score -= 35;
  else if (status.state === 'degraded') score -= 20;
  if (sample.mspt != null) {
    if (sample.mspt > 80) score -= 25;
    else if (sample.mspt > 55) score -= 12;
  }
  if (sample.tps1m != null) {
    if (sample.tps1m < 15) score -= 20;
    else if (sample.tps1m < 18) score -= 10;
  }
  if (state.metrics?.heapUsedPercent != null) {
    if (state.metrics.heapUsedPercent > 90) score -= 18;
    else if (state.metrics.heapUsedPercent > 80) score -= 8;
  }
  if (sample.cpuUsagePercent != null) {
    if (sample.cpuUsagePercent > 90) score -= 10;
    else if (sample.cpuUsagePercent > 75) score -= 5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderHero() {
  const server = state.server || {};
  const status = state.status || {};
  const metrics = state.metrics || {};
  const tone = serverStateTone();
  const online = status.state === 'online';
  const label = (status.state || 'offline').toUpperCase();

  $('#ovName').textContent = server.name || 'Minecraft Server';
  const pill = $('#ovPill');
  pill.textContent = `● ${label}`;
  pill.style.cssText =
    tone === 'g'
      ? ''
      : `color:${tone === 'r' ? '#ef4444' : '#f5b82c'};border-color:${tone === 'r' ? '#ef4444' : '#f5b82c'};background:rgba(239,68,68,.12)`;
  $('#ovAddr').textContent = serverAddress() || 'address not set';
  const software = status.software || server.software;
  const mcVersion = status.minecraftVersion || server.minecraftVersion;
  $('#ovMeta').textContent = software || (mcVersion ? `Minecraft ${mcVersion}` : 'Version unknown');

  const uptimeSeconds = metrics.uptimeSeconds ?? status.uptimeSeconds;
  $('#up').textContent = F.uptimeText(uptimeSeconds);
  $('#upSince').textContent =
    uptimeSeconds != null
      ? `Last restart: ${F.dateTime(new Date(Date.now() - uptimeSeconds * 1000).toISOString())}`
      : status.lastHeartbeatAt
        ? `Last heartbeat ${F.ago(status.lastHeartbeatAt)}`
        : 'No heartbeat yet';
  $('#tel').textContent = status.lastTelemetryAt ? `● ${F.ago(status.lastTelemetryAt)}` : '● no data';
  $('#tel').classList.toggle('mp-online-pill', Boolean(status.lastTelemetryAt) && tone === 'g');

  const address = serverAddress();
  $('#jnMotd').textContent = address ? `Connect with ${address}` : 'Server address not configured';

  // Sidebar server card
  $('#srvName').textContent = server.name || 'Minecraft Server';
  const srvState = $('#srvState');
  srvState.className = tone === 'g' ? 'g' : tone === 'r' ? 'r' : 'm';
  srvState.innerHTML = `<i class="dot ${online ? '' : 'off'}"></i>${label}`;
  $('#srvMeta').textContent = [status.minecraftVersion, status.software].filter(Boolean).join(' · ') || 'Waiting for agent';
}

function renderStats() {
  const metrics = state.metrics || {};
  const sample = metrics.sample || {};
  const status = state.status || {};
  const tone = serverStateTone();
  const pc = metrics.playerCount;
  const maxp = metrics.maxPlayers;
  const heapPct = metrics.heapUsedPercent;
  const usedGb = sample.heapUsedBytes != null ? F.gigabytes(sample.heapUsedBytes) : '—';
  const maxGb = sample.heapMaxBytes != null ? F.gigabytes(sample.heapMaxBytes) : '—';
  const pcPct = pc != null && maxp ? Math.round((pc / maxp) * 100) : null;
  const uptimeSeconds = metrics.uptimeSeconds;

  // Deltas are measured against the average of the currently selected window.
  const points = state.history[ui.range]?.points || [];
  const avgMspt = F.seriesAvg(points.map((p) => p.mspt));
  const avgCpu = F.seriesAvg(points.map((p) => p.cpuUsagePercent));

  const offline = tone === 'r' || !status.agentConnected;
  const msptWar = sample.mspt != null && sample.mspt > 75;
  const redStyle = 'color:#ef4444;border-color:#ef4444;background:rgba(239,68,68,.12)';
  const yellowStyle = 'color:#f5b82c;border-color:#f5b82c;background:rgba(245,184,46,.12)';

  let msptSub = '<span>no sample</span>';
  if (sample.mspt != null) {
    if (avgMspt) {
      const dir = sample.mspt < avgMspt ? '▼' : '▲';
      const delta = Math.abs((1 - sample.mspt / avgMspt) * 100).toFixed(0);
      msptSub = `<span class="g">${dir} ${delta}%</span><span>(lower is better)</span>`;
    } else {
      msptSub = `<span class="g">${sample.mspt < 50 ? 'within tick budget' : 'above 50 ms budget'}</span>`;
    }
  }

  let cpuSub = `<span class="g">${status.agentConnected ? 'agent connected' : 'agent offline'}</span>`;
  if (sample.cpuUsagePercent != null && avgCpu) {
    const dir = sample.cpuUsagePercent < avgCpu ? '▼' : '▲';
    const delta = Math.abs(sample.cpuUsagePercent - avgCpu).toFixed(0);
    cpuSub = `<span class="g">${dir} ${delta}%</span>`;
  }
  cpuSub += `<span style="margin-left:auto;text-align:right">${offline ? '—' : F.uptimeText(uptimeSeconds)}</span>`;

  const cards = [
    {
      icon: 'users',
      label: 'Players',
      value: pc == null ? '—' : pc,
      unit: maxp ? `/ ${maxp}` : '',
      sub:
        pcPct != null
          ? `<div class="bar"><i style="width:${pcPct}%"></i></div><span>${pcPct}%</span>`
          : `<span>${status.agentConnected ? 'awaiting heartbeat' : 'agent offline'}</span>`,
    },
    {
      icon: 'chart',
      label: 'TPS',
      value: F.tps(sample.tps1m),
      unit: '',
      sub: `<span class="g">1m ${F.tps(sample.tps1m)} &nbsp; 5m ${F.tps(sample.tps5m)} &nbsp; 15m ${F.tps(sample.tps15m)}</span>`,
    },
    { icon: 'doc', label: 'MSPT', value: sample.mspt == null ? '—' : F.fixed(sample.mspt, 1), unit: ' ms', sub: msptSub },
    {
      icon: 'memory',
      label: 'Memory (Heap)',
      value: usedGb,
      unit: maxGb === '—' ? '' : `/ ${maxGb}`,
      sub:
        heapPct != null
          ? `<div class="bar"><i style="width:${heapPct}%"></i></div><span>${Math.round(heapPct)}%</span>`
          : '<span>no sample</span>',
    },
    {
      icon: 'cpu',
      label: 'CPU Usage',
      value: sample.cpuUsagePercent == null ? '—' : `${Math.round(sample.cpuUsagePercent)}%`,
      unit: '',
      sub: cpuSub,
    },
  ];

  $('#stats').innerHTML = cards
    .map((card, index) => {
      let tag = '';
      if (index) {
        const label = offline ? 'Offline' : tone === 'y' ? 'Warning' : index === 2 && msptWar ? 'Warning' : 'Healthy';
        const style = offline || (index === 2 && msptWar) ? redStyle : tone === 'y' ? yellowStyle : '';
        tag = `<span class="tag" style="${style}">${label}</span>`;
      }
      return `<div class="card st"><div class="ico">${ic(card.icon)}</div><div><small>${card.label}</small><div class="v">${card.value} <span>${card.unit}</span></div></div>${tag}<div class="sub">${card.sub}</div></div>`;
    })
    .join('');
}

const CHART_CONFIG = [
  { key: 'tps', title: 'TPS', color: '#22c55e', min: 0, max: 20, get: (p) => p.tps1m, fmt: (v) => F.tps(v), ys: () => ['20', '15', '10', '5', '0'] },
  {
    key: 'mspt',
    title: 'MSPT',
    color: '#38bdf8',
    min: 0,
    max: (points) => Math.max(60, Math.ceil((F.seriesMax(points.map((p) => p.mspt)) || 0) / 10) * 10),
    get: (p) => p.mspt,
    fmt: (v) => (v == null ? '—' : `${F.fixed(v, 1)} ms`),
    ys: (points) => {
      const max = Math.max(60, Math.ceil((F.seriesMax(points.map((p) => p.mspt)) || 0) / 10) * 10);
      return [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), '0'];
    },
  },
  {
    key: 'mem',
    title: 'Memory Usage',
    color: '#a855f7',
    min: 0,
    max: 100,
    get: (p) => (p.heapUsedBytes != null && p.heapMaxBytes ? (p.heapUsedBytes / p.heapMaxBytes) * 100 : null),
    fmt: (v) => F.pct(v),
    ys: () => ['100%', '75%', '50%', '25%', '0%'],
  },
  {
    key: 'players',
    title: 'Player Count',
    color: '#38bdf8',
    min: 0,
    max: () => Math.max(5, (state.metrics?.maxPlayers || 20)),
    get: (p) => p.playerCount,
    fmt: (v) => F.num(v),
    ys: (points) => {
      const max = Math.max(5, state.metrics?.maxPlayers || F.seriesMax(points.map((p) => p.playerCount)) || 10);
      return [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), '0'];
    },
  },
  {
    key: 'cpu',
    title: 'CPU Usage',
    color: '#f97316',
    min: 0,
    max: 100,
    get: (p) => p.cpuUsagePercent,
    fmt: (v) => F.pct(v),
    ys: () => ['100%', '75%', '50%', '25%', '0%'],
  },
];

/**
 * Network traffic is a derived rate (bytes/s from cumulative counters), so it is
 * kept out of CHART_CONFIG (which the overview also renders) and fed augmented
 * points from {@link netRateSeries}.
 */
const NET_CHART = {
  key: 'net',
  title: 'Network Traffic',
  color: '#14b8a6',
  min: 0,
  max: (points) => Math.max(1024, F.seriesMax(points.map((p) => p.netRate)) || 0),
  get: (p) => p.netRate,
  fmt: (v) => (v == null ? '—' : `${F.bytes(v)}/s`),
  ys: (points) => {
    const max = Math.max(1024, F.seriesMax(points.map((p) => p.netRate)) || 0);
    return [F.bytes(max), F.bytes(max * 0.75), F.bytes(max * 0.5), F.bytes(max * 0.25), '0'];
  },
};

function xLabels(points) {
  if (!points || points.length < 2) return '<span>—</span><span>—</span><span>—</span><span>—</span>';
  const count = 4;
  const labels = [];
  for (let i = 0; i < count; i += 1) {
    const point = points[Math.round(((points.length - 1) * i) / (count - 1))];
    labels.push(ui.range === '7d' ? F.compactDate(point.recordedAt) : F.clock(point.recordedAt));
  }
  return labels.map((l) => `<span>${h(l)}</span>`).join('');
}

function chartCard(cfg, points, prefix) {
  const values = points.map(cfg.get);
  const withData = values.some((v) => v != null);
  const lastValue = F.seriesLast(values);
  if (!withData) {
    return `<div class="ch"><h4>${cfg.title}<em class="mp-muted">no data</em></h4>${empty('No samples in this range yet')}</div>`;
  }
  const max = typeof cfg.max === 'function' ? cfg.max(points) : cfg.max;
  const min = typeof cfg.min === 'function' ? cfg.min(points) : cfg.min;
  const ys = typeof cfg.ys === 'function' ? cfg.ys(points) : cfg.ys;
  const path = F.sparkPath(values, min, max);
  const id = `grad-${prefix}-${cfg.key}`;
  return `<div class="ch"><h4>${cfg.title}<em style="color:${cfg.color}">${cfg.fmt(lastValue)}</em></h4><div class="pl"><div class="yl">${ys
    .map((y) => `<span>${y}</span>`)
    .join('')}</div><svg viewBox="0 0 300 100" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cfg.color}" stop-opacity=".45"/><stop offset="1" stop-color="${cfg.color}" stop-opacity=".02"/></linearGradient></defs><path d="${path}L300,100L0,100Z" fill="url(#${id})"/><path d="${path}" fill="none" stroke="${cfg.color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div><div class="xl">${xLabels(
    points,
  )}</div></div>`;
}

function renderCharts(container, prefix) {
  const node = typeof container === 'string' ? $(container) : container;
  if (!node) return;
  const points = state.history[ui.range]?.points || [];
  if (!points.length) {
    node.innerHTML = `<div class="card" style="grid-column:1/-1">${empty('No metric history yet — waiting for the agent')}</div>`;
    return;
  }
  node.innerHTML = CHART_CONFIG.map((cfg) => chartCard(cfg, points, prefix)).join('');
}

function renderOverviewPlayers() {
  const tab = ui.ovPlayersTab;
  let list;
  if (tab === 'online') list = state.playersOnline;
  else if (tab === 'top') list = [...state.playersAll].sort((a, b) => b.totalPlaytimeSeconds - a.totalPlaytimeSeconds);
  else list = [...state.playersAll].sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
  list = (list || []).slice(0, 5);

  $('#pt').innerHTML =
    list
      .map((p) => {
        const online = p.online;
        const joined = online ? F.ago(p.currentSessionStartedAt) : '—';
        const session = online && p.currentSessionStartedAt
          ? F.duration((Date.now() - new Date(p.currentSessionStartedAt).getTime()) / 1000)
          : '—';
        return `<tr class="mp-click" data-uuid="${h(p.uuid)}"><td>${avatar(p.uuid, 16, null, p.lastKnownUsername)}${h(
          p.lastKnownUsername,
        )}</td><td class="m">${h(p.uuid.slice(0, 8))}…</td><td>${joined}</td><td>${session}</td></tr>`;
      })
      .join('') || `<tr><td class="m" colspan="4">No players</td></tr>`;

  const onlineCount = state.playersOnline.length;
  const tb = $('#ovPtb');
  if (tb) tb.querySelector('span').textContent = `Online (${onlineCount})`;
}

function renderOverviewPlugins() {
  const plugins = state.plugins?.plugins || [];
  $('#pg').innerHTML =
    plugins
      .slice(0, 8)
      .map(
        (p) => `<tr><td><span class="pa"></span>${h(p.pluginName)}</td><td>${h(p.version)}</td><td class="${p.enabled ? 'en' : 'm'}">${
          p.enabled ? 'Enabled' : 'Disabled'
        }</td></tr>`,
      )
      .join('') || `<tr><td class="m" colspan="3">No plugin snapshot yet</td></tr>`;
}

function renderHeartbeat() {
  const metrics = state.metrics || {};
  const sample = metrics.sample || {};
  const status = state.status || {};
  $('#hbState').textContent = status.agentConnected ? 'Success' : 'Offline';
  $('#hb').innerHTML = rows([
    ['Time', status.lastHeartbeatAt ? F.dateTime(status.lastHeartbeatAt) : '—'],
    ['Players', metrics.playerCount == null ? '—' : `${metrics.playerCount} / ${metrics.maxPlayers ?? '—'}`],
    ['TPS', F.tps(sample.tps1m)],
    ['MSPT', F.mspt(sample.mspt)],
    ['Memory', `${sample.heapUsedBytes != null ? F.gigabytes(sample.heapUsedBytes) : '—'} / ${sample.heapMaxBytes != null ? F.gigabytes(sample.heapMaxBytes) : '—'}`],
    ['Agent', metrics.agentVersion || 'unknown'],
  ]);
}

function renderActivity() {
  const points = state.history24?.points || [];
  const bars = $('#bars');
  const stats = $('#paStats');
  const values = points.map((p) => p.playerCount);

  if (!values.length || !values.some((v) => v != null)) {
    bars.innerHTML = '';
    stats.innerHTML = `<div><span>Peak Players</span><b>—</b></div><div><span>Average Players</span><b>—</b></div><div><span>Unique (today)</span><b>—</b></div><div><span>Sessions (today)</span><b>—</b></div>`;
    return;
  }

  const max = Math.max(1, F.seriesMax(values) || 1);
  const bucketCount = 60;
  const filled = Array.from({ length: bucketCount }, (_, i) => {
    const idx = Math.min(values.length - 1, Math.floor((i / bucketCount) * values.length));
    return values[idx] ?? 0;
  });
  bars.innerHTML = filled
    .map((v) => `<i style="height:${Math.max(4, Math.round((v / max) * 100))}%"></i>`)
    .join('');

  const today = (state.activity?.points || []).slice(-1)[0] || {};
  stats.innerHTML = [
    ['Peak Players', F.num(F.seriesMax(values))],
    ['Average Players', F.fixed(F.seriesAvg(values), 1)],
    ['Unique (today)', F.num(today.uniquePlayers ?? '—')],
    ['Sessions (today)', F.num(today.sessions ?? '—')],
  ]
    .map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`)
    .join('');
}

function renderLogs() {
  $('#lg').innerHTML =
    state.eventsRecent
      .slice(0, 6)
      .map(
        (e) => `<div><span class="${e.severity === 'info' ? 'g' : 'r'}">▲</span><b>${F.clock(
          e.occurredAt,
        )}</b>${h(e.summary)}</div>`,
      )
      .join('') || empty('No events yet');
}

function renderHealth() {
  const score = healthScore();
  const ring = $('#healthRing');
  const color = score >= 80 ? 'var(--g)' : score >= 55 ? 'var(--y)' : 'var(--r)';
  ring.style.background = `conic-gradient(${color} 0 ${score}%, #143029 0)`;
  ring.querySelector('b').textContent = `${score}%`;

  const checks = [
    ['Server Connection', state.status?.state === 'online' || state.status?.state === 'degraded'],
    ['Database', Boolean(state.server)],
    ['WebSocket', state.socketConnected],
    ['Agent', Boolean(state.status?.agentConnected)],
  ];
  $('#healthList').innerHTML = checks
    .map(([label, ok]) => `<span style="color:${ok ? 'inherit' : '#f5b82c'}">${label}: ${ok ? 'OK' : 'down'}</span>`)
    .join('');
}

function renderServerStatusCard() {
  const status = state.status || {};
  const tone = serverStateTone();
  const label = { online: 'Online & Healthy', degraded: 'Degraded', stale: 'Stale data', offline: 'Offline' }[status.state] || 'Unknown';
  const stateEl = $('#ssState');
  stateEl.style.color = tone === 'g' ? 'var(--g)' : tone === 'r' ? '#ef4444' : '#f5b82c';
  stateEl.querySelector('span').textContent = label;
  $('#ssReason').textContent = status.reason || (status.state === 'online' ? 'Everything is running smoothly.' : 'Check the agent connection.');
}

function renderServerInfo() {
  const server = state.server || {};
  const status = state.status || {};
  const metrics = state.metrics || {};
  $('#ssk').innerHTML = rows([
    ['Minecraft Version', h(status.minecraftVersion || server.minecraftVersion || '—')],
    ['Server Software', h(status.software || server.software || '—')],
    ['Server Address', h(serverAddress() || 'not set')],
    ['Agent Connectivity', status.agentConnected ? `<span class="g">● Connected</span>` : `<span style="color:#ef4444">● Disconnected</span>`],
    ['Agent Version', h(metrics.agentVersion || '—')],
    ['Last Heartbeat', status.lastHeartbeatAt ? F.ago(status.lastHeartbeatAt) : '—'],
  ]);
}

function renderOverviewAlerts() {
  const open = (state.alerts.incidents || []).filter((i) => i.status === 'open').slice(0, 4);
  const toneMap = { critical: ['r', '#ef4444', '#450a0a'], warning: ['y', '#f5b82e', '#422006'], info: ['g', '#22c55e', '#03170a'] };
  $('#alist').innerHTML =
    open
      .map((incident) => {
        const [tone, fill, stroke] = toneMap[incident.ruleSeverity] || toneMap.warning;
        const icon = incident.ruleSeverity === 'info' ? 'check' : 'alert';
        return `<div class="al"><svg class="i ${tone}" viewBox="0 0 24 24" style="fill:${fill};stroke:${stroke};font-size:22px"><path d="${
          ICONS[icon] ?? ''
        }"/></svg><div><b style="color:${fill}">${h(incident.ruleName)}</b><small>${h(
          incident.summary || '',
        )}</small></div><time>${F.ago(incident.startedAt)}</time></div>`;
      })
      .join('') || empty('No active alerts');
}

function renderRecentEvents() {
  $('#ev').innerHTML =
    state.eventsRecent
      .slice(0, 6)
      .map(
        (e) => `<div class="ev"><div class="ea" style="background:${EVENT_TONE[e.severity] || '#1f9d55'}">${ic(
          EVENT_ICON[e.eventType] || 'info',
        )}</div><div><b>${h(e.summary)}</b><small>${h(e.eventType.replace(/_/g, ' '))}</small></div><time>${F.ago(
          e.occurredAt,
        )}</time></div>`,
      )
      .join('') || empty('No recent events');
}

function renderQuickActions() {
  $('#qa').innerHTML = [
    ['chart', 'Health report', 'health'],
    ['doc', 'Export metrics', 'export-metrics'],
    ['download', 'Export events', 'export-events'],
    ['refresh', 'Refresh data', 'refresh'],
  ]
    .map(([icon, label, action]) => `<div class="mp-click" data-act="${action}">${ic(icon)}${label}</div>`)
    .join('');
}

function renderOverview() {
  renderHero();
  renderStats();
  renderCharts('#cg', 'o');
  renderOverviewPlayers();
  renderOverviewPlugins();
  renderHeartbeat();
  renderActivity();
  renderLogs();
  renderHealth();
  renderServerStatusCard();
  renderServerInfo();
  renderOverviewAlerts();
  renderRecentEvents();
  renderQuickActions();
}

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */

const PAGES = {};

PAGES.overview = {
  render: () => '',
  mount: () => {},
};

PAGES.performance = {
  render() {
    const name = state.server?.name || 'this server';
    return `<div class="pgw">
      <div class="ph2"><div><h2>Performance</h2><p>Live health, tick timing, memory and profiling for ${h(name)}</p></div><div class="tools">${rangeTabs(
        'ptabs',
      )}<button class="bt" data-act="health">Health report</button></div></div>
      <div class="sh">Live health</div><div class="g4" id="pf1"></div>
      <div class="sh">Tick rate and tick time</div><div class="g12" id="pf2"></div>
      <div class="sh">Where the server spends its time</div><div class="g12" id="pf3"></div>
      <div class="sh">Resources</div><div class="g12" id="pf4"></div>
      <div class="sh">Plugins and garbage collection</div><div class="g12" id="pf5"></div>
      <div class="sh">Details</div><div class="g12" id="pf6"></div>
      <div id="pr"></div>
    </div>`;
  },
  mount(root) {
    const draw = () => drawPerformance();
    const tabs = $('#ptabs', root);
    tabs.addEventListener('click', (event) => {
      const target = event.target.closest('span[data-r]');
      if (!target) return;
      ui.range = target.dataset.r;
      $$('#ptabs span', root).forEach((s) => s.classList.toggle('on', s.dataset.r === ui.range));
      renderChartsHome();
      loadHistory(ui.range).then(draw).catch(() => draw());
    });
    draw();
  },
};

function renderChartsHome() {
  // Keep the overview chart range selector in sync when the range changes elsewhere.
  $$('#tabs span').forEach((s) => s.classList.toggle('on', s.dataset.r === ui.range));
}

/* ------------------------------------------------------------------ *
 * Performance page building blocks
 * ------------------------------------------------------------------ */

const PERF_PALETTE = ['#22c55e', '#38bdf8', '#a855f7', '#f5b82e', '#f97316', '#ef4444', '#14b8a6'];
const PERF_MUTED = '#7d9a92';

/** Green below `good`, amber below `bad`, red at or above — "lower is better". */
const perfLow = (value, good, bad) =>
  value == null ? PERF_MUTED : value < good ? '#22c55e' : value < bad ? '#f5b82e' : '#ef4444';

/** Green above `good`, amber above `bad`, red at or below — "higher is better". */
const perfHigh = (value, good, bad) =>
  value == null ? PERF_MUTED : value > good ? '#22c55e' : value > bad ? '#f5b82e' : '#ef4444';

/** Radial gauge. `value`/`max` fill the arc; `text`/`sub` label the centre. */
function gauge(value, max, color, text, sub) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, Number(value) / max)) : 0;
  return `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" fill="none" stroke="#12302b" stroke-width="12"/><circle cx="60" cy="60" r="48" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(ratio * 301.6).toFixed(1)} 301.6" transform="rotate(-90 60 60)"/><text x="60" y="62" text-anchor="middle" fill="#e8f3ef" font-size="21" font-weight="600">${text}</text><text x="60" y="78" text-anchor="middle" fill="#7d9a92" font-size="9">${sub}</text></svg>`;
}

/** Gauge card: ring plus key/value rows. */
const gaugeCard = (title, ringSvg, details) =>
  `<div class="card"><div class="ct">${title}</div><div class="rcb">${ringSvg}<div>${rows(details)}</div></div></div>`;

/** Donut chart with a centre label. Items are [label, value, colour?]. */
function donut(items, centerText, centerSub, size = 124, thickness = 16) {
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const total = items.reduce((sum, item) => sum + item[1], 0) || 1;
  let offset = 0;
  const slices = items
    .map((item, i) => {
      const length = (item[1] / total) * circumference;
      const slice = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${
        item[2] || PERF_PALETTE[i % 7]
      }" stroke-width="${thickness}" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(
        2,
      )}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      offset += length;
      return slice;
    })
    .join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${
    size / 2
  }" r="${r}" fill="none" stroke="#12302b" stroke-width="${thickness}"/>${slices}<text x="${size / 2}" y="${
    size / 2 + 3
  }" text-anchor="middle" fill="#e8f3ef" font-size="17" font-weight="600">${centerText}</text><text x="${
    size / 2
  }" y="${size / 2 + 17}" text-anchor="middle" fill="#7d9a92" font-size="9">${centerSub}</text></svg>`;
}

/** Filled pie (no centre). Items are [label, value, colour?]. */
function pie(items, size = 124) {
  const total = items.reduce((sum, item) => sum + item[1], 0) || 1;
  const c = size / 2;
  let angle = -Math.PI / 2;
  const slices = items
    .map((item, i) => {
      const sweep = (item[1] / total) * 2 * Math.PI;
      const end = angle + sweep;
      const largeArc = sweep > Math.PI ? 1 : 0;
      const x0 = c + c * Math.cos(angle);
      const y0 = c + c * Math.sin(angle);
      const x1 = c + c * Math.cos(end);
      const y1 = c + c * Math.sin(end);
      const slice = `<path d="M${c},${c}L${x0.toFixed(2)},${y0.toFixed(
        2,
      )}A${c},${c} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)}Z" fill="${
        item[2] || PERF_PALETTE[i % 7]
      }" stroke="#08151a" stroke-width="1.5"/>`;
      angle = end;
      return slice;
    })
    .join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${slices}</svg>`;
}

/** Legend list. `format` renders each value. */
const legend = (items, format) =>
  `<div class="lgd">${items
    .map(
      (item, i) =>
        `<div><i style="background:${item[2] || PERF_PALETTE[i % 7]}"></i>${h(item[0])}<b>${format(item[1])}</b></div>`,
    )
    .join('')}</div>`;

/** Vertical bars across a fixed viewBox, with an optional budget line. */
function columnChart(values, max, colorFn, threshold) {
  const n = values.length || 1;
  const w = 300 / n;
  const bars = values
    .map((value, i) => {
      const height = Math.min(100, (value / max) * 100);
      return `<rect x="${(i * w + w * 0.15).toFixed(2)}" y="${(100 - height).toFixed(2)}" width="${(
        w * 0.7
      ).toFixed(2)}" height="${Math.max(1, height).toFixed(2)}" fill="${colorFn(value)}" rx="1.5"/>`;
    })
    .join('');
  const budget = threshold
    ? `<line x1="0" x2="300" y1="${100 - (threshold / max) * 100}" y2="${
        100 - (threshold / max) * 100
      }" stroke="#ef4444" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`
    : '';
  return `<svg viewBox="0 0 300 100" preserveAspectRatio="none" style="width:100%;height:110px;border-left:1px solid #1b3a35;border-bottom:1px solid #1b3a35;background:repeating-linear-gradient(#0000 0 24px,rgba(255,255,255,.05) 24px 25px)">${bars}${budget}</svg>`;
}

/** Horizontal bars for interval rows. Items are [label, value, colour?]. */
const hbars = (items, max, format) =>
  items
    .map(
      (item) =>
        `<div class="hbr"><span>${h(item[0])}</span><span class="bar"><i style="width:${Math.min(
          100,
          ((item[1] ?? 0) / max) * 100,
        )}%${item[2] ? `;background:${item[2]}` : ''}"></i></span><b>${format(item[1])}</b></div>`,
    )
    .join('');

/** Honest placeholder for data the Paper API does not expose. */
const unavailable = (message) => empty(message);

/** Total GC time as a percentage of process uptime. */
function gcOverheadPercent(sample, uptimeSeconds) {
  const gc = Array.isArray(sample.gc) ? sample.gc : [];
  if (!gc.length || !uptimeSeconds) return null;
  const totalMs = gc.reduce((sum, g) => sum + (Number(g.totalMs) || 0), 0);
  return (totalMs / (uptimeSeconds * 1000)) * 100;
}

/** Cumulative GC time summed across collectors for one sample. */
function gcTotalOf(sample) {
  const gc = Array.isArray(sample.gc) ? sample.gc : [];
  if (!gc.length) return null;
  return gc.reduce((sum, g) => sum + (Number(g.totalMs) || 0), 0);
}

/**
 * Per-poll GC pause series. Cumulative counters are differenced across
 * consecutive samples, so every value is the time actually spent in GC during
 * that interval. The live sample is folded in when newer than the last point.
 */
function gcPauseSeries(points, sample) {
  const totals = [];
  for (const point of points) {
    if (point.gcTotalMs != null) totals.push({ at: point.recordedAt, total: point.gcTotalMs });
  }
  const live = gcTotalOf(sample);
  if (live != null && sample.recordedAt) {
    const last = totals[totals.length - 1];
    if (!last || new Date(sample.recordedAt).getTime() > new Date(last.at).getTime()) {
      totals.push({ at: sample.recordedAt, total: live });
    } else {
      last.total = live;
    }
  }
  const pauses = [];
  for (let i = 1; i < totals.length; i += 1) {
    pauses.push(Math.max(0, totals[i].total - totals[i - 1].total));
  }
  return pauses.slice(-16);
}

/** Heap regions (old/young/other/free, in bytes) for the memory donut. */
function memoryRegions(sample, heapUsed, heapMax) {
  if (heapUsed == null || heapMax == null) return null;
  const used = Number(heapUsed);
  const max = Number(heapMax);
  const free = Math.max(0, max - used);
  const old = sample.heapOldBytes == null ? null : Number(sample.heapOldBytes);
  const young = sample.heapYoungBytes == null ? null : Number(sample.heapYoungBytes);
  if (old == null && young == null) {
    return [
      ['Used heap', used, '#22c55e'],
      ['Free', free, '#1d3b36'],
    ];
  }
  return [
    ['Old generation', old || 0, '#a855f7'],
    ['Young generation', young || 0, '#38bdf8'],
    ['Other heap', Math.max(0, used - (old || 0) - (young || 0)), '#f5b82e'],
    ['Free', free, '#1d3b36'],
  ];
}

/**
 * TPS across the five mockup intervals. Bukkit exposes real 1m/5m/15m averages;
 * the 5s/10s figures are derived from the latest measured tick times.
 */
function tpsByInterval(points, sample) {
  const ms = points
    .map((p) => p.mspt)
    .filter((v) => v != null)
    .map(Number);
  const last = ms.length ? ms[ms.length - 1] : sample.mspt;
  const tail = ms.slice(-2);
  const avgTail = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : last;
  const fromMspt = (value) => (value && value > 0 ? Math.min(20, 1000 / value) : null);
  return [
    ['5s', fromMspt(last)],
    ['10s', fromMspt(avgTail)],
    ['1m', sample.tps1m],
    ['5m', sample.tps5m],
    ['15m', sample.tps15m],
  ];
}

/**
 * Main-thread categories the agent sampled during this interval, as
 * [name, samples, colour] items. Samples are share of the server thread.
 */
function tickBreakdownItems(sample) {
  const list = Array.isArray(sample.tickBreakdown) ? sample.tickBreakdown : [];
  return list
    .filter((t) => t && t.samples > 0)
    .sort((a, b) => b.samples - a.samples)
    .map((t, i) => [t.name, t.samples, PERF_PALETTE[i % PERF_PALETTE.length]]);
}

/** Per-plugin main-thread samples, as [name, samples] items. */
function pluginCostItems(sample) {
  const list = Array.isArray(sample.pluginTickCost) ? sample.pluginTickCost : [];
  return list
    .filter((p) => p && p.samples > 0)
    .sort((a, b) => b.samples - a.samples)
    .map((p) => [p.name, p.samples]);
}

/**
 * Bytes/s derived from the agent's cumulative network counters. Counters are
 * differenced across consecutive raw points; aggregate ranges carry no counters,
 * so their rates stay null rather than inventing traffic.
 */
function netRateSeries(points) {
  return points.map((point, i) => {
    const prev = points[i - 1];
    const rx = point.netRxBytes;
    const tx = point.netTxBytes;
    if (rx == null || tx == null || !prev || prev.netRxBytes == null || prev.netTxBytes == null) {
      return { ...point, netRate: null };
    }
    const seconds = (new Date(point.recordedAt).getTime() - new Date(prev.recordedAt).getTime()) / 1000;
    if (!(seconds > 0)) return { ...point, netRate: null };
    const delta = rx - prev.netRxBytes + (tx - prev.netTxBytes);
    return { ...point, netRate: delta >= 0 ? delta / seconds : null };
  });
}

function drawPerformance() {
  const points = state.history[ui.range]?.points || [];
  const sample = state.metrics?.sample || {};
  const metrics = state.metrics || {};
  const status = state.status || {};
  const system = status.system || {};
  const uptime = metrics.uptimeSeconds ?? status.uptimeSeconds ?? null;

  const msValues = points.map((p) => p.mspt);
  const ms60 = msValues.filter((v) => v != null).slice(-60);
  const ms30 = msValues.filter((v) => v != null).slice(-30);
  const tps = sample.tps1m;
  const mspt = sample.mspt;
  const cpu = sample.cpuUsagePercent;
  const heapUsed = sample.heapUsedBytes;
  const heapMax = sample.heapMaxBytes;
  const heapGb = heapUsed == null ? null : Number(heapUsed) / 1024 ** 3;
  const maxGb = heapMax == null ? null : Number(heapMax) / 1024 ** 3;
  const heapPct = heapUsed != null && heapMax ? (Number(heapUsed) / Number(heapMax)) * 100 : null;
  const gcOverhead = gcOverheadPercent(sample, uptime);
  const gc = Array.isArray(sample.gc) ? sample.gc : [];
  const cpuAvg = F.seriesAvg(points.map((p) => p.cpuUsagePercent).slice(-60));
  const msValue = (v) => (v == null ? '—' : F.fixed(v, 1));
  const msLabel = (v) => (v == null ? '—' : `${F.fixed(v, 1)} ms`);
  const tickItems = tickBreakdownItems(sample);
  const tickTotal = tickItems.reduce((sum, item) => sum + item[1], 0);
  const pluginItems = pluginCostItems(sample);

  // --- Live health (four gauges) ---
  const pf1 = $('#pf1');
  if (pf1) {
    pf1.innerHTML =
      gaugeCard(
        'TPS',
        gauge(tps ?? 0, 20, perfHigh(tps, 19, 15), tps == null ? '—' : F.tps(tps), 'of 20'),
        [['Last 1m', F.tps(sample.tps1m)], ['Last 5m', F.tps(sample.tps5m)], ['Last 15m', F.tps(sample.tps15m)]],
      ) +
      gaugeCard(
        'MSPT',
        gauge(mspt ?? 0, 50, perfLow(mspt, 40, 50), mspt == null ? '—' : F.fixed(mspt, 0), 'ms / 50'),
        [
          ['Median', msValue(F.percentile(ms60, 0.5))],
          ['95th %', msValue(F.percentile(ms60, 0.95))],
          ['Max', msValue(F.seriesMax(ms60))],
        ],
      ) +
      gaugeCard(
        'CPU',
        gauge(cpu ?? 0, 100, perfLow(cpu, 60, 85), cpu == null ? '—' : `${Math.round(cpu)}%`, 'process'),
        [
          ['Average', cpuAvg == null ? '—' : `${F.fixed(cpuAvg, 0)}%`],
          ['Cores', system.cpuCores == null ? '—' : `${F.num(system.cpuCores)} vCPU`],
          ['Threads', sample.threadCount == null ? '—' : F.num(sample.threadCount)],
        ],
      ) +
      gaugeCard(
        'Heap',
        gauge(
          heapPct ?? 0,
          100,
          perfLow(heapPct, 70, 85),
          heapGb == null ? '—' : heapGb.toFixed(1),
          maxGb == null ? 'of heap' : `of ${maxGb.toFixed(1)} GB`,
        ),
        [
          ['Used', heapGb == null ? '—' : `${heapGb.toFixed(2)} GB`],
          ['Free', heapGb == null || maxGb == null ? '—' : `${(maxGb - heapGb).toFixed(2)} GB`],
          ['GC overhead', gcOverhead == null ? '—' : `${gcOverhead.toFixed(2)}%`],
        ],
      );
  }

  // --- Tick rate and tick time (two large charts) ---
  const pf2 = $('#pf2');
  if (pf2) {
    pf2.innerHTML =
      `<div class="s6 big">${chartCard(CHART_CONFIG[0], points, 'p')}</div>` +
      `<div class="s6 big">${chartCard(CHART_CONFIG[1], points, 'p')}</div>`;
  }

  // --- Where the server spends its time ---
  const pf3 = $('#pf3');
  if (pf3) {
    const regions = memoryRegions(sample, heapUsed, heapMax);
    pf3.innerHTML =
      `<div class="card s4"><div class="ct">Tick time breakdown <small>share of each tick</small></div>${
        tickTotal
          ? `<div class="cc">${pie(tickItems)}${legend(tickItems, (v) => `${((v / tickTotal) * 100).toFixed(1)}%`)}</div>`
          : unavailable('No main-thread samples yet — the profiler is warming up')
      }</div>` +
      `<div class="card s4"><div class="ct">Memory distribution <small>${
        maxGb == null ? 'heap' : `${maxGb.toFixed(1)} GB heap`
      }</small></div>${
        regions
          ? `<div class="cc">${donut(regions, heapPct == null ? '—' : `${Math.round(heapPct)}%`, 'used')}${legend(
              regions,
              (v) => `${(v / 1024 ** 3).toFixed(2)} GB`,
            )}</div>`
          : unavailable('Heap region data has not been reported yet')
      }</div>` +
      `<div class="card s4"><div class="ct">MSPT per tick <small>last ${ms30.length} samples</small></div>${
        ms30.length
          ? columnChart(ms30, 80, (v) => (v > 50 ? '#ef4444' : v > 40 ? '#f5b82e' : '#22c55e'), 50)
          : unavailable('No tick samples in this range')
      }<div class="m" style="font-size:10px;margin-top:4px">Red line = 50 ms tick budget</div></div>`;
  }

  // --- Resources (four charts; network is a derived rate) ---
  const pf4 = $('#pf4');
  if (pf4) {
    const netPoints = netRateSeries(points);
    const hasCounters = sample.netRxBytes != null || points.some((p) => p.netRxBytes != null);
    const hasRate = netPoints.some((p) => p.netRate != null);
    let network;
    if (!hasCounters) {
      network = `<div class="ch"><h4>Network Traffic<em class="mp-muted">no data</em></h4>${unavailable(
        'The agent has not reported host network counters yet.',
      )}</div>`;
    } else if (!hasRate) {
      network = `<div class="ch"><h4>Network Traffic<em class="mp-muted">raw range only</em></h4>${unavailable(
        'Network rate is computed from raw samples — choose the 15m or 1h range.',
      )}</div>`;
    } else {
      network = chartCard(NET_CHART, netPoints, 'pn');
    }
    pf4.innerHTML =
      `<div class="s3 sm">${chartCard(CHART_CONFIG[2], points, 'p')}</div>` +
      `<div class="s3 sm">${chartCard(CHART_CONFIG[3], points, 'p')}</div>` +
      `<div class="s3 sm">${chartCard(CHART_CONFIG[4], points, 'p')}</div>` +
      `<div class="s3 sm">${network}</div>`;
  }

  // --- Plugins and garbage collection ---
  const pf5 = $('#pf5');
  if (pf5) {
    const pauses = gcPauseSeries(points, sample);
    pf5.innerHTML =
      `<div class="card s6"><div class="ct">Plugin tick cost <small>% of tick time</small></div>${
        pluginItems.length && tickTotal
          ? hbars(pluginItems, tickTotal, (v) => `${((v / tickTotal) * 100).toFixed(1)}%`)
          : unavailable('No plugin frames have been sampled yet')
      }</div>` +
      `<div class="card s6"><div class="ct">GC pauses <small>last ${pauses.length} polls (ms)</small></div>${
        pauses.length
          ? columnChart(pauses, Math.max(40, ...pauses), (v) => (v > 20 ? '#f5b82e' : '#38bdf8'))
          : unavailable('No garbage collection samples yet')
      }${
        gc.length
          ? `<table class="t" style="margin-top:6px"><thead><tr><th>Collector</th><th>Count</th><th>Total</th><th>Avg</th><th>Last</th></tr></thead><tbody>${gc
              .map((g) => {
                const count = Number(g.count) || 0;
                const total = Number(g.totalMs) || 0;
                return `<tr><td>${h(g.name)}</td><td>${F.num(count)}</td><td>${F.fixed(total, 0)} ms</td><td>${
                  count > 0 ? `${F.fixed(total / count, 1)} ms` : '—'
                }</td><td>${g.lastMs == null ? '—' : `${F.fixed(g.lastMs, 0)} ms`}</td></tr>`;
              })
              .join('')}</tbody></table>`
          : ''
      }</div>`;
  }

  // --- Details ---
  const pf6 = $('#pf6');
  if (pf6) {
    const intervals = tpsByInterval(points, sample);
    const tpsBars = hbars(intervals, 20, (v) => F.tps(v));
    const median = F.percentile(ms60, 0.5);
    const p95 = F.percentile(ms60, 0.95);
    const overBudget = ms60.filter((v) => v > 50).length;
    const distRows = rows([
      ['Minimum', msLabel(F.seriesMin(msValues))],
      ['Median', msLabel(median)],
      ['95th percentile', msLabel(p95)],
      ['Maximum', msLabel(F.seriesMax(msValues))],
      ['Ticks over 50 ms', `${overBudget} of ${ms60.length}`],
    ]);
    const java = system.javaVersion
      ? `${system.javaVersion}${system.javaVendor ? ` (${system.javaVendor})` : ''}`
      : null;
    const jvmArgs = Array.isArray(system.jvmArgs) && system.jvmArgs.length ? system.jvmArgs.join(' ') : null;
    const os = [system.osName, system.osVersion].filter(Boolean).join(' ');
    const osLabel = os ? `${os}${system.osArch ? ` (${system.osArch})` : ''}` : null;
    const disk =
      system.diskTotalBytes != null
        ? `${system.diskUsableBytes != null ? F.gigabytes(system.diskUsableBytes) : '—'} free / ${F.gigabytes(
            system.diskTotalBytes,
          )}`
        : null;
    const entities = sample.entityCount == null ? '—' : F.num(sample.entityCount);
    const chunks = sample.chunkCount == null ? '—' : F.num(sample.chunkCount);
    const sysRows = rows([
      ['Java', java ? h(java) : '—'],
      ['JVM flags', jvmArgs ? `<span class="mp-ell" title="${h(jvmArgs)}">${h(jvmArgs)}</span>` : '—'],
      ['OS', osLabel ? h(osLabel) : '—'],
      ['Disk', disk ?? '—'],
      ['Entities / chunks', entities === '—' && chunks === '—' ? '—' : `${entities} / ${chunks}`],
      ['Uptime', F.uptimeText(uptime)],
    ]);
    pf6.innerHTML =
      `<div class="card s4"><div class="ct">TPS by interval</div>${tpsBars}</div>` +
      `<div class="card s4"><div class="ct">MSPT distribution <small>60 samples</small></div>${distRows}</div>` +
      `<div class="card s4"><div class="ct">System</div>${sysRows}</div>`;
  }

  renderProfiler();
}

/**
 * Profiler slot. The agent samples the main server thread continuously, so this
 * card reports the live ranking of what the thread was doing plus the plugins
 * that owned the sampled frames — it is not a start/stop control.
 */
function renderProfiler() {
  const node = $('#pr');
  if (!node) return;
  const sample = state.metrics?.sample || {};
  const tickItems = tickBreakdownItems(sample);
  const total = tickItems.reduce((sum, item) => sum + item[1], 0);
  if (!total) {
    node.innerHTML = `<div class="card"><div class="sec">Profiler <span class="bx x">Warming up</span></div>${empty(
      'The agent samples the main server thread every metrics interval. Rankings appear after the next sample.',
    )}</div>`;
    return;
  }
  const share = (samples) => `${((samples / total) * 100).toFixed(1)}%`;
  const categories = hbars(tickItems, total, (v) => share(v));
  const plugins = pluginCostItems(sample)
    .map(
      (item) =>
        `<div class="hbr" style="padding-left:18px"><span class="m">${h(item[0])}</span><span class="bar"><i style="width:${Math.min(
          100,
          (item[1] / total) * 100,
        )}%;background:#38bdf8"></i></span><b>${share(item[1])}</b></div>`,
    )
    .join('');
  node.innerHTML = `<div class="card"><div class="sec">Profiler <span class="bx s">Sampling</span><span class="m" style="font-weight:400">${F.num(
    total,
  )} samples · main server thread</span></div>${categories}${plugins}</div>`;
}

/* ---------------------------- Players ---------------------------- */

const PLAYER_SORTS = {
  recent: (a, b) => (Date.parse(b.lastSeenAt || 0) || 0) - (Date.parse(a.lastSeenAt || 0) || 0),
  name: (a, b) => a.lastKnownUsername.localeCompare(b.lastKnownUsername),
  playtime: (a, b) => b.totalPlaytimeSeconds - a.totalPlaytimeSeconds,
  sessions: (a, b) => b.sessionCount - a.sessionCount,
};

const SEEN_WINDOWS = {
  any: null,
  '24h': 24 * 3600e3,
  '7d': 7 * 24 * 3600e3,
  '30d': 30 * 24 * 3600e3,
};

function playerStatusBadge(p) {
  return p.online ? '<span class="bx s">Online</span>' : '<span class="bx x">Offline</span>';
}

function opBadge(p) {
  return p.operator ? '<span class="bx i" style="margin-left:6px">OP</span>' : '';
}

function sessionLength(p) {
  if (!p.online || !p.currentSessionStartedAt) return '—';
  const seconds = (Date.now() - Date.parse(p.currentSessionStartedAt)) / 1000;
  return seconds > 0 ? F.duration(seconds) : '—';
}

function filteredPlayers() {
  const { search, tab, status, world, sort, seen } = ui.players;
  const now = Date.now();
  const seenMs = SEEN_WINDOWS[seen] ?? null;
  const query = search.trim().toLowerCase();
  let rows = state.playersAll.slice();

  if (tab === 'banned' || status === 'banned') rows = rows.filter((p) => p.banned);
  else if (tab === 'online' || status === 'online') rows = rows.filter((p) => p.online);
  else if (status === 'offline') rows = rows.filter((p) => !p.online);
  else if (status === 'operators') rows = rows.filter((p) => p.operator);

  if (world !== 'all') rows = rows.filter((p) => p.online && p.world === world);
  if (tab === 'recent') rows = rows.filter((p) => p.lastSeenAt && now - Date.parse(p.lastSeenAt) <= SEEN_WINDOWS['24h']);
  if (seenMs != null) rows = rows.filter((p) => p.lastSeenAt && now - Date.parse(p.lastSeenAt) <= seenMs);

  if (query) {
    rows = rows.filter(
      (p) => p.lastKnownUsername.toLowerCase().includes(query) || p.uuid.toLowerCase().includes(query),
    );
  }

  const comparator = tab === 'top' ? PLAYER_SORTS.playtime : PLAYER_SORTS[sort] || PLAYER_SORTS.recent;
  rows.sort(comparator);
  return rows;
}

function playersPeak24h() {
  const points = state.history24?.points || [];
  let peak = null;
  for (const point of points) {
    if (point.playerCount == null) continue;
    peak = peak == null ? point.playerCount : Math.max(peak, point.playerCount);
  }
  return peak;
}

function avgOnlinePing() {
  const pings = state.playersOnline.map((p) => p.pingMs).filter((v) => v != null);
  if (!pings.length) return null;
  return pings.reduce((a, b) => a + b, 0) / pings.length;
}

/** 24 hourly buckets of peak concurrent players taken from the 1-minute rollup. */
function hourlyActivity() {
  const points = state.history24?.points || [];
  if (!points.length) return null;
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setTime(start.getTime() - 23 * 3600e3);
  const buckets = new Array(24).fill(0);
  const seen = new Array(24).fill(false);
  for (const point of points) {
    if (point.playerCount == null) continue;
    const index = Math.floor((Date.parse(point.recordedAt) - start.getTime()) / 3600e3);
    if (index < 0 || index > 23) continue;
    buckets[index] = seen[index] ? Math.max(buckets[index], point.playerCount) : point.playerCount;
    seen[index] = true;
  }
  return buckets;
}

function playersByWorld() {
  const counts = new Map();
  for (const p of state.playersAll) {
    if (!p.online || !p.world) continue;
    counts.set(p.world, (counts.get(p.world) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([world, count]) => ({ world, count }))
    .sort((a, b) => b.count - a.count);
}

/** Distinct worlds seen in the live roster, for the world filter. */
function playerWorlds() {
  const worlds = new Set();
  for (const p of state.playersAll) {
    if (p.online && p.world) worlds.add(p.world);
  }
  return Array.from(worlds).sort((a, b) => a.localeCompare(b));
}

function mbar(value, max) {
  const pctWidth = max ? Math.min(100, (value / max) * 100) : 0;
  return `<span class="bar inl" style="width:90px"><i style="width:${pctWidth}%"></i></span>`;
}

function drawPlayersKpis() {
  const el = $('#pkp');
  if (!el) return;
  const analytics = state.playersAnalytics || {};
  const onlineNow = state.playersOnline.length;
  const maxPlayers = state.metrics?.maxPlayers ?? null;
  const peak = playersPeak24h();
  const ping = avgOnlinePing();
  const cards = [
    ['Online now', `${onlineNow}${maxPlayers ? ` / ${maxPlayers}` : ''}`],
    ['Peak today', peak == null ? '—' : F.num(peak)],
    ['Unique (24h)', analytics.uniquePlayers == null ? '—' : F.num(analytics.uniquePlayers)],
    ['New players (24h)', analytics.newPlayers == null ? '—' : F.num(analytics.newPlayers)],
    ['Avg session', analytics.avgSessionSeconds == null ? '—' : F.duration(analytics.avgSessionSeconds)],
    ['Avg ping', ping == null ? '—' : `${Math.round(ping)} ms`],
  ];
  el.innerHTML = cards.map(([label, value]) => `<div class="card"><small>${label}</small><b>${value}</b></div>`).join('');
}

function drawPlayersPanels() {
  const el = $('#ppn');
  if (!el) return;
  const activity = hourlyActivity();
  const peak = activity ? Math.max(1, ...activity) : 0;
  const activityCard = `<div class="card"><div class="ct">Activity <small>last 24 hours · peak concurrent</small></div>${
    activity
      ? `<div class="bars" style="height:80px">${activity
          .map((value) => `<i style="height:${Math.round((value / peak) * 100)}%"></i>`)
          .join('')}</div><div class="xl"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>`
      : empty('No player-count history in the last 24 hours')
  }</div>`;

  const worlds = playersByWorld();
  const worldMax = Math.max(1, ...worlds.map((w) => w.count));
  const worldRows = worlds.length
    ? worlds
        .slice(0, 5)
        .map(
          (w) =>
            `<div class="tr"><span style="flex:1">${h(w.world)}</span>${mbar(w.count, worldMax)}<span>${w.count}</span></div>`,
        )
        .join('')
    : '<div class="m" style="padding:4px 0">No online players — world comes from live heartbeats</div>';

  const retention = (state.playersAnalytics?.retention) || [];
  const retentionRows = retention.length
    ? retention
        .map(
          (r) =>
            `<div class="kv"><span>${h(r.label)}</span><span>${r.pct == null ? '—' : `${Math.round(r.pct)}%`} <small class="m">(${r.cohort})</small></span></div>`,
        )
        .join('')
    : '<div class="kv"><span>Not enough history</span><span>—</span></div>';

  const worldCard = `<div class="card"><div class="ct">Players by world <small>online only</small></div>${worldRows}<div class="ct" style="margin-top:10px">Retention <small>returned after N days</small></div>${retentionRows}</div>`;

  const buckets = state.playersAnalytics?.sessionBuckets || [];
  const bucketMax = Math.max(1, ...buckets.map((b) => b.count));
  const bucketRows = buckets.length
    ? buckets
        .map(
          (b) =>
            `<div class="tr"><span style="flex:1">${h(b.label)}</span>${mbar(b.count, bucketMax)}<span>${b.count}</span></div>`,
        )
        .join('')
    : '<div class="m" style="padding:4px 0">No sessions in this window</div>';
  const avg = state.playersAnalytics?.avgSessionSeconds;
  const sessionCard = `<div class="card"><div class="ct">Session length <small>${
    avg == null ? 'no data' : `avg ${F.duration(avg)}`
  }</small></div>${bucketRows}</div>`;

  el.innerHTML = activityCard + worldCard + sessionCard;
}

function drawPlayersTable() {
  const table = $('#ptab');
  if (!table) return;

  const rows = filteredPlayers();
  const pageSize = ui.players.pageSize;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (ui.players.page > totalPages) ui.players.page = totalPages;
  const page = ui.players.page;
  const items = rows.slice((page - 1) * pageSize, page * pageSize);

  const joinedHeader = ui.players.tab === 'online' ? 'Joined' : 'Last seen';
  const blocked = disAttr(!isAdmin());
  const allVisibleSelected = items.length > 0 && items.every((p) => ui.players.selected[p.uuid]);

  table.innerHTML = `<thead><tr><th style="width:28px"><input type="checkbox" data-select-all${
    allVisibleSelected ? ' checked' : ''
  }></th><th>Player</th><th>World</th><th>Ping</th><th>${joinedHeader}</th><th>Session</th><th class="mp-num">Playtime</th><th></th></tr></thead><tbody>${
    items
      .map(
        (p) => `<tr class="mp-click" data-uuid="${h(p.uuid)}">
          <td><input type="checkbox" data-select="${h(p.uuid)}"${
            ui.players.selected[p.uuid] ? ' checked' : ''
          }></td>
          <td>${avatar(p.uuid, 16, null, p.lastKnownUsername)}<a class="lk" data-open="${h(p.uuid)}">${h(
            p.lastKnownUsername,
          )}</a>${opBadge(p)}${p.banned ? ' <span class="bx c">Banned</span>' : ''}${
            p.muted ? ' <span class="bx w">Muted</span>' : ''
          }<div class="m" style="font-size:10px;margin-left:24px">${h(p.uuid)}</div></td>
          <td>${p.online ? h(p.world || '—') : '—'}</td>
          <td style="color:${p.online && p.pingMs != null && p.pingMs > 80 ? '#f5c64a' : '#22c55e'}">${
            p.online && p.pingMs != null ? `${p.pingMs} ms` : '—'
          }</td>
          <td>${p.online ? 'now' : p.lastSeenAt ? F.ago(p.lastSeenAt) : '—'}</td>
          <td>${sessionLength(p)}</td>
          <td class="mp-num">${F.duration(p.totalPlaytimeSeconds)}</td>
          <td style="text-align:right;white-space:nowrap">${
            p.online ? `<button class="bt" data-row-action="kick" data-uuid="${h(p.uuid)}"${blocked}>Kick</button> ` : ''
          }<button class="bt ${p.banned ? '' : 'dn'}" data-row-action="${
            p.banned ? 'unban' : 'ban'
          }" data-uuid="${h(p.uuid)}"${blocked}>${p.banned ? 'Unban' : 'Ban'}</button> <button class="bt" data-open="${h(
            p.uuid,
          )}">Details</button></td>
        </tr>`,
      )
      .join('') || `<tr><td class="m" colspan="8">No players match these filters</td></tr>`
  }</tbody>`;

  const counter = $('#psl');
  if (counter) counter.textContent = `Showing ${items.length} of ${rows.length}`;

  const pager = $('#ppager');
  if (pager) {
    const from = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(rows.length, page * pageSize);
    pager.innerHTML = `<span class="m">${from}–${to} of ${rows.length}</span><button class="bt" data-page="${page - 1}" ${
      page <= 1 ? 'disabled' : ''
    }>Previous</button><button class="bt" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next</button>`;
  }
}

function refreshWorldOptions() {
  const el = $('#pworld');
  if (!el) return;
  const worlds = playerWorlds();
  if (ui.players.world !== 'all' && !worlds.includes(ui.players.world)) ui.players.world = 'all';
  const options = [['all', 'All worlds'], ...worlds.map((w) => [w, w])];
  el.innerHTML = options
    .map(([value, label]) => `<option value="${value}"${value === ui.players.world ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function drawPlayersPage() {
  refreshWorldOptions();
  drawPlayersKpis();
  drawPlayersPanels();
  drawPlayersTable();
}

PAGES.players = {
  render() {
    const onlineCount = state.playersOnline.length;
    const known = state.playersRosterTotal || state.playersAll.length;
    return `<div class="pgw">
      <div class="ph2"><div><h2>Players</h2><p>${onlineCount} online · ${known} known players</p></div><div class="tools">
        <input class="in" id="psearch" placeholder="Search name or UUID" value="${h(ui.players.search)}" style="width:200px">
        ${selectHTML('pworld', [['all', 'All worlds'], ...playerWorlds().map((w) => [w, w])], ui.players.world)}
        ${selectHTML(
          'pstatus',
          [
            ['all', 'All players'],
            ['online', 'Online'],
            ['offline', 'Offline'],
            ['operators', 'Operators'],
          ],
          ui.players.status,
        )}
        ${selectHTML(
          'psort',
          [
            ['recent', 'Recent'],
            ['name', 'Name'],
            ['playtime', 'Playtime'],
            ['sessions', 'Sessions'],
          ],
          ui.players.sort,
        )}
        ${selectHTML(
          'pseen',
          [
            ['any', 'Any time'],
            ['24h', 'Last 24h'],
            ['7d', 'Last 7 days'],
            ['30d', 'Last 30 days'],
          ],
          ui.players.seen,
        )}
      </div></div>
      <div class="kp6" id="pkp"></div>
      <div class="wg3" id="ppn"></div>
      <div class="row">
        <div class="tabs" id="ptb" style="margin-left:0">
          <span data-k="online" class="${ui.players.tab === 'online' ? 'on' : ''}">Online</span>
          <span data-k="recent" class="${ui.players.tab === 'recent' ? 'on' : ''}">Recent (24h)</span>
          <span data-k="all" class="${ui.players.tab === 'all' ? 'on' : ''}">All players</span>
          <span data-k="top" class="${ui.players.tab === 'top' ? 'on' : ''}">Top players</span>
          <span data-k="banned" class="${ui.players.tab === 'banned' ? 'on' : ''}">Banned</span>
        </div>
        <span style="flex:1"></span>
        <span class="m" id="psl"></span>
        <button class="bt" data-bulk="kick"${disAttr(!isAdmin())}>Kick selected</button>
        <button class="bt dn" data-bulk="ban"${disAttr(!isAdmin())}>Ban selected</button>
        <input class="in" id="bc" placeholder="Broadcast message" value="${h(
          ui.profile.broadcast,
        )}" style="width:200px"${disAttr(!isAdmin())}>
        <button class="bt pr" data-broadcast${disAttr(!isAdmin())}>Broadcast</button>
      </div>
      <div class="card"><table class="t" id="ptab"></table></div>
      <div class="mp-pager" id="ppager"></div>
    </div>`;
  },
  mount(root) {
    const search = $('#psearch', root);
    search.addEventListener('input', () => {
      ui.players.search = search.value;
      ui.players.page = 1;
      drawPlayersPage();
    });

    const bindSelect = (id, key) => {
      const el = $('#' + id, root);
      if (el) {
        el.addEventListener('change', () => {
          ui.players[key] = el.value;
          ui.players.page = 1;
          drawPlayersPage();
        });
      }
    };
    bindSelect('pworld', 'world');
    bindSelect('pstatus', 'status');
    bindSelect('psort', 'sort');
    bindSelect('pseen', 'seen');

    $('#ptb', root).addEventListener('click', (event) => {
      const target = event.target.closest('span[data-k]');
      if (!target) return;
      ui.players.tab = target.dataset.k;
      ui.players.page = 1;
      $$('#ptb span', root).forEach((s) => s.classList.toggle('on', s.dataset.k === ui.players.tab));
      drawPlayersPage();
    });

    $('#ppager', root).addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      ui.players.page = Number(btn.dataset.page);
      drawPlayersPage();
    });

    $('#ptab', root).addEventListener('click', (event) => {
      const selectAll = event.target.closest('input[data-select-all]');
      if (selectAll) {
        const checked = selectAll.checked;
        $$('#ptab tbody tr[data-uuid]', root).forEach((tr) => {
          ui.players.selected[tr.dataset.uuid] = checked;
        });
        drawPlayersTable();
        return;
      }
      const select = event.target.closest('input[data-select]');
      if (select) {
        ui.players.selected[select.dataset.select] = select.checked;
        drawPlayersTable();
        return;
      }
      const rowAction = event.target.closest('[data-row-action]');
      if (rowAction) {
        runRowAction(rowAction.dataset.rowAction, rowAction.dataset.uuid);
        return;
      }
      const details = event.target.closest('[data-open]');
      if (details) {
        openPlayer(details.dataset.open);
        return;
      }
      const row = event.target.closest('tr[data-uuid]');
      if (row) openPlayer(row.dataset.uuid);
    });

    $$('[data-bulk]', root).forEach((btn) =>
      btn.addEventListener('click', () => runBulkAction(btn.dataset.bulk)),
    );

    const broadcastInput = $('#bc', root);
    if (broadcastInput) {
      broadcastInput.addEventListener('input', () => {
        ui.profile.broadcast = broadcastInput.value;
      });
      broadcastInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') sendBroadcast(broadcastInput.value);
      });
    }
    const broadcastBtn = $('[data-broadcast]', root);
    if (broadcastBtn) broadcastBtn.addEventListener('click', () => sendBroadcast($('#bc', root)?.value));

    drawPlayersPage();
    Promise.all([
      state.playersAll.length ? Promise.resolve() : loadPlayersAll(),
      state.playersAnalytics ? Promise.resolve() : loadPlayersAnalytics(),
    ])
      .then(drawPlayersPage)
      .catch(reportError);
  },
};

/** Per-plugin share of sampled main-thread time, keyed by lowercased plugin name. */
function pluginTickCostMap() {
  const sample = state.metrics?.sample || {};
  const total = tickBreakdownItems(sample).reduce((sum, item) => sum + item[1], 0);
  const map = new Map();
  if (!total) return map;
  for (const entry of Array.isArray(sample.pluginTickCost) ? sample.pluginTickCost : []) {
    if (!entry || !entry.samples) continue;
    map.set(String(entry.name).toLowerCase(), (entry.samples / total) * 100);
  }
  return map;
}

/** Inline tick-cost bar, scaled like the design (1% fills ~16% of the track). */
const tickCostCell = (pct) =>
  pct == null
    ? '<span class="m" title="No profiler samples for this plugin yet">—</span>'
    : `<span class="bar inl"><i style="width:${Math.min(100, pct * 16)}%"></i></span>${pct.toFixed(2)}%`;

/** Honest placeholder for a metric the agent does not collect. */
const notCollected = (title) => `<span class="m" title="${h(title)}">—</span>`;

PAGES.plugins = {
  render() {
    const snapshot = state.plugins;
    const count = snapshot?.plugins?.length || 0;
    const when = snapshot?.collectedAt ? F.ago(snapshot.collectedAt) : 'never';
    return `<div class="pgw">
      <div class="ph2"><div><h2>Plugins</h2><p>Status, performance and updates — ${count} installed, last inventory ${h(when)}</p></div><div class="tools">
        <input class="in" id="gsearch" placeholder="Search plugins" value="${h(ui.plugins.search)}">
        ${selectHTML(
          'gfilter',
          [
            ['all', 'All'],
            ['enabled', 'Enabled'],
            ['disabled', 'Disabled'],
            ['update', 'Has update'],
            ['heavy', 'Heavy (>3%)'],
          ],
          ui.plugins.filter,
        )}
        ${selectHTML(
          'gsort',
          [
            ['name', 'Name'],
            ['tick', 'Tick cost'],
            ['memory', 'Memory'],
          ],
          ui.plugins.sort,
        )}
        <button class="bt" disabled title="Plugin update checks are not configured — update plugins manually on the server.">Check for updates</button>
        <button class="bt" disabled title="Plugin updates are not configured — update plugins manually on the server.">Update all</button>
        <button class="bt pr" disabled title="The agent cannot change plugin state — enable plugins in the server configuration.">Enable all</button>
      </div></div>
      <div class="kp6" id="gk"></div>
      <div class="card"><table class="t" id="gtab"></table></div>
    </div>`;
  },
  mount(root) {
    const search = $('#gsearch', root);
    search.addEventListener('input', () => {
      ui.plugins.search = search.value.trim();
      drawPlugins();
    });
    $('#gfilter', root).addEventListener('change', (event) => {
      ui.plugins.filter = event.target.value;
      drawPlugins();
    });
    $('#gsort', root).addEventListener('change', (event) => {
      ui.plugins.sort = event.target.value;
      drawPlugins();
    });
    $('#gtab', root).addEventListener('click', (event) => {
      const cell = event.target.closest('[data-plugin]');
      if (cell) showPluginDetail(cell.dataset.plugin);
    });
    drawPlugins();
  },
};

function drawPlugins() {
  const snapshot = state.plugins;
  const plugins = snapshot?.plugins || [];
  const tick = pluginTickCostMap();
  const tickOf = (p) => {
    const value = tick.get(p.pluginName.toLowerCase());
    return p.enabled && value != null ? value : null;
  };
  const enabled = plugins.filter((p) => p.enabled);

  const kk = $('#gk');
  if (kk) {
    const sampled = plugins.filter((p) => tickOf(p) != null);
    const totalTick = enabled.reduce((sum, p) => sum + (tickOf(p) ?? 0), 0);
    kk.innerHTML = [
      kpi('Total', F.num(plugins.length)),
      kpi('Enabled', F.num(enabled.length)),
      kpi('Disabled', F.num(plugins.length - enabled.length)),
      kpi('Updates', notCollected('Plugin update checks are not configured')),
      kpi('Tick cost', sampled.length ? `${F.fixed(totalTick, 1)}%` : notCollected('No plugin frames sampled yet')),
      kpi('Memory', notCollected('Per-plugin memory is not measured')),
    ].join('');
  }

  const table = $('#gtab');
  if (!table) return;

  const query = ui.plugins.search.toLowerCase();
  const filter = ui.plugins.filter;
  let list = plugins.filter((p) => p.pluginName.toLowerCase().includes(query));
  if (filter === 'enabled') list = list.filter((p) => p.enabled);
  else if (filter === 'disabled') list = list.filter((p) => !p.enabled);
  else if (filter === 'heavy') list = list.filter((p) => (tickOf(p) ?? 0) > 3);
  else if (filter === 'update') list = [];
  list = [...list].sort((a, b) =>
    ui.plugins.sort === 'tick'
      ? (tickOf(b) ?? -1) - (tickOf(a) ?? -1)
      : a.pluginName.localeCompare(b.pluginName),
  );

  const headers =
    '<thead><tr><th>Name</th><th>Version</th><th>Author</th><th>Tick cost</th><th>Memory</th><th>Commands</th><th>Status</th><th>On</th><th></th></tr></thead>';
  const body =
    filter === 'update'
      ? '<tr><td class="m" colspan="9">Update checks are not configured — no update data is collected</td></tr>'
      : list
          .map(
            (p) => `<tr>
            <td><b class="lk" data-plugin="${h(p.pluginName)}">${h(p.pluginName)}</b></td>
            <td>${h(p.version)}</td>
            <td class="m">${p.author ? h(p.author) : notCollected('This plugin does not declare an author')}</td>
            <td>${tickCostCell(tickOf(p))}</td>
            <td>${notCollected('Per-plugin memory is not measured')}</td>
            <td>${p.commandCount == null ? notCollected('Command count not reported') : F.num(p.commandCount)}</td>
            <td><span class="bx ${p.enabled ? 's' : 'x'}">${p.enabled ? 'Enabled' : 'Disabled'}</span></td>
            <td><span class="sw ${p.enabled ? 'on' : ''} ro" title="Plugin state is read-only — the agent cannot enable or disable plugins"></span></td>
            <td style="text-align:right"><button class="bt" disabled title="Plugin reload is not configured — restart the server to apply plugin changes.">Reload</button></td>
          </tr>`,
          )
          .join('') || '<tr><td class="m" colspan="9">No plugins match</td></tr>';

  table.innerHTML = headers + `<tbody>${body}</tbody>`;
}

function showPluginDetail(name) {
  const plugin = (state.plugins?.plugins || []).find((p) => p.pluginName === name);
  if (!plugin) return;
  const pct = plugin.enabled ? pluginTickCostMap().get(plugin.pluginName.toLowerCase()) : null;
  modal(`<h3>${h(plugin.pluginName)} <span class="bx ${plugin.enabled ? 's' : 'x'}">${
    plugin.enabled ? 'Enabled' : 'Disabled'
  }</span></h3>
  <div class="m">${plugin.author ? `by ${h(plugin.author)}` : 'author not reported'}</div>
  ${rows([
    ['Version', h(plugin.version)],
    ['API version', plugin.apiVersion ? h(plugin.apiVersion) : '—'],
    ['Tick cost', pct == null ? notCollected('No profiler samples for this plugin yet') : `${F.fixed(pct, 2)}%`],
    ['Memory', notCollected('Per-plugin memory is not measured')],
    ['Commands', plugin.commandCount == null ? notCollected('Command count not reported') : F.num(plugin.commandCount)],
    ['Status', plugin.enabled ? 'Enabled' : 'Disabled'],
  ])}
  <div class="row" style="justify-content:flex-end"><button class="bt pr" data-close-modal>Close</button></div>`);
  const close = $('#md [data-close-modal]');
  if (close) close.addEventListener('click', closeModal);
}

PAGES.events = {
  render() {
    return `<div class="pgw">
      <div class="ph2"><div><h2>Events &amp; Logs</h2><p>Structured events reported by the agent</p></div><div class="tools">
        <input class="in" id="esearch" placeholder="Filter messages" value="${h(ui.events.search)}">
        <select class="in" id="esev"><option value="">All levels</option>${['info', 'warning', 'critical']
          .map((s) => `<option value="${s}" ${ui.events.severity === s ? 'selected' : ''}>${s}</option>`)
          .join('')}</select>
        <select class="in" id="ecat"><option value="">All categories</option>${EVENT_CATEGORIES.map(
          (c) => `<option value="${c}" ${ui.events.category === c ? 'selected' : ''}>${c.replace(/_/g, ' ')}</option>`,
        ).join('')}</select>
        <button class="bt" data-act="export-events">Export CSV</button>
      </div></div>
      <div class="card"><table class="t" id="etab"></table></div>
      <div class="mp-pager" id="epager"></div>
    </div>`;
  },
  mount(root) {
    const search = $('#esearch', root);
    let timer = null;
    search.addEventListener('input', () => {
      ui.events.search = search.value.trim();
      ui.events.page = 1;
      clearTimeout(timer);
      timer = setTimeout(() => loadEventsPage().then(drawEvents).catch(reportError), 250);
    });
    $('#esev', root).addEventListener('change', (event) => {
      ui.events.severity = event.target.value;
      ui.events.page = 1;
      loadEventsPage().then(drawEvents).catch(reportError);
    });
    $('#ecat', root).addEventListener('change', (event) => {
      ui.events.category = event.target.value;
      ui.events.page = 1;
      loadEventsPage().then(drawEvents).catch(reportError);
    });
    $('#epager', root).addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-page]');
      if (!btn) return;
      ui.events.page = Number(btn.dataset.page);
      loadEventsPage().then(drawEvents).catch(reportError);
    });
    $('#etab', root).addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-id]');
      if (!row) return;
      const evt = state.eventsPage?.items.find((e) => e.id === row.dataset.id);
      if (evt) openEvent(evt);
    });
    loadEventsPage().then(drawEvents).catch(reportError);
  },
};

function drawEvents() {
  const table = $('#etab');
  if (!table) return;
  const data = state.eventsPage;
  if (!data) {
    table.innerHTML = `<tbody><tr><td class="m">Loading…</td></tr></tbody>`;
    return;
  }
  table.innerHTML = `<thead><tr><th>Time</th><th>Severity</th><th>Category</th><th>Message</th></tr></thead><tbody>${
    data.items
      .map(
        (e) => `<tr class="mp-click" data-id="${h(e.id)}"><td class="m">${F.dateTime(e.occurredAt)}</td><td><span class="bx ${
          { info: 'i', warning: 'w', critical: 'c' }[e.severity] || 'i'
        }">${e.severity}</span></td><td class="m">${h(e.eventType.replace(/_/g, ' '))}</td><td>${h(e.summary)}</td></tr>`,
      )
      .join('') || `<tr><td class="m" colspan="4">No events match these filters</td></tr>`
  }</tbody>`;
  const pager = $('#epager');
  if (pager) {
    const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
    const to = Math.min(data.total, data.page * data.pageSize);
    pager.innerHTML = `<span class="m">${from}–${to} of ${data.total}</span><button class="bt" data-page="${data.page - 1}" ${
      data.page <= 1 ? 'disabled' : ''
    }>Previous</button><button class="bt" data-page="${data.page + 1}" ${data.page >= data.totalPages ? 'disabled' : ''}>Next</button>`;
  }
}

PAGES.alerts = {
  render() {
    const incidents = state.alerts.incidents || [];
    const rules = state.alerts.rules || [];
    return `<div class="pgw">
      <div class="ph2"><div><h2>Alerts</h2><p>Incidents raised by alert rules</p></div><div class="tools">
        <span class="mp-tag">Discord: ${state.alerts.discordConfigured ? 'configured' : 'not configured'}</span>
        <button class="bt pr" data-act="new-rule">New rule</button>
      </div></div>
      <div class="kp" id="ak"></div>
      <div class="card"><div class="sec">Incidents</div><table class="t" id="itab"></table></div>
      <div class="card"><div class="sec">Alert rules</div><table class="t" id="rtab"></table></div>
    </div>`;
  },
  mount() {
    drawAlerts();
  },
};

function drawAlerts() {
  const incidents = state.alerts.incidents || [];
  const rules = state.alerts.rules || [];
  const ak = $('#ak');
  if (ak) {
    ak.innerHTML = [
      ['Open incidents', incidents.filter((i) => i.status === 'open').length],
      ['Resolved', incidents.filter((i) => i.status === 'resolved').length],
      ['Rules enabled', `${rules.filter((r) => r.enabled).length} / ${rules.length}`],
      ['Discord', state.alerts.discordConfigured ? 'Configured' : 'Not configured'],
    ]
      .map(([label, value]) => kpi(label, value))
      .join('');
  }

  const itab = $('#itab');
  if (itab) {
    itab.innerHTML = `<thead><tr><th>Rule</th><th>Severity</th><th>Status</th><th>Started</th><th>Resolved</th><th class="mp-num">Trigger</th></tr></thead><tbody>${
      incidents
        .map(
          (i) => `<tr><td>${h(i.ruleName)}</td><td><span class="bx ${F.SEVERITY_TONE[i.ruleSeverity] || 'w'}">${
            i.ruleSeverity
          }</span></td><td><span class="bx ${i.status === 'open' ? 'w' : 's'}">${i.status}</span></td><td class="m">${F.dateTime(
            i.startedAt,
          )}</td><td class="m">${i.resolvedAt ? F.dateTime(i.resolvedAt) : '—'}</td><td class="mp-num">${i.triggerValue == null ? '—' : F.fixed(i.triggerValue, 1)}</td></tr>`,
        )
        .join('') || `<tr><td class="m" colspan="6">No incidents recorded</td></tr>`
    }</tbody>`;
  }

  const rtab = $('#rtab');
  if (rtab) {
    rtab.innerHTML = `<thead><tr><th>Rule</th><th>Severity</th><th>Condition</th><th>Window</th><th>Cooldown</th><th>Last triggered</th><th>Enabled</th><th></th></tr></thead><tbody>${
      rules
        .map((r) => {
          const op = OPERATORS.find(([value]) => value === r.operator)?.[1] || r.operator;
          const metric = METRICS.find(([value]) => value === r.metric)?.[1] || r.metric;
          return `<tr><td>${h(r.name)}</td><td><span class="bx ${F.SEVERITY_TONE[r.severity] || 'w'}">${r.severity}</span></td><td class="m">${h(
            metric,
          )} ${op} ${r.threshold}</td><td class="m">${r.evaluationWindowSeconds}s</td><td class="m">${r.cooldownSeconds}s</td><td class="m">${
            r.lastTriggeredAt ? F.ago(r.lastTriggeredAt) : 'never'
          }</td><td><span class="sw ${r.enabled ? 'on' : ''} mp-click" data-rule="${h(r.id)}" data-op="toggle"></span></td><td style="text-align:right;white-space:nowrap"><button class="bt sm" data-rule="${h(
            r.id,
          )}" data-op="test">Test</button> <button class="bt sm" data-rule="${h(r.id)}" data-op="edit">Edit</button> <button class="bt sm dn" data-rule="${h(
            r.id,
          )}" data-op="delete">Delete</button></td></tr>`;
        })
        .join('') || `<tr><td class="m" colspan="8">No alert rules yet — create one to get notified</td></tr>`
    }</tbody>`;
  }
}

function openRuleForm(rule) {
  const isEdit = Boolean(rule);
  const value = rule || {
    name: '',
    metric: 'tps',
    operator: 'lt',
    threshold: 18,
    evaluationWindowSeconds: 60,
    severity: 'warning',
    cooldownSeconds: 600,
    enabled: true,
  };
  modal(`<h3>${isEdit ? 'Edit alert rule' : 'New alert rule'}</h3>
    <div class="fm" style="grid-template-columns:150px 1fr">
      <label>Name</label><input class="in" id="rf-name" value="${h(value.name)}">
      <label>Metric</label><select class="in" id="rf-metric">${METRICS.map(
        ([k, label]) => `<option value="${k}" ${value.metric === k ? 'selected' : ''}>${label}</option>`,
      ).join('')}</select>
      <label>Operator</label><select class="in" id="rf-op">${OPERATORS.map(
        ([k, label]) => `<option value="${k}" ${value.operator === k ? 'selected' : ''}>${label}</option>`,
      ).join('')}</select>
      <label>Threshold</label><input class="in" type="number" step="any" id="rf-threshold" value="${value.threshold}">
      <label>Evaluation window (s)</label><input class="in" type="number" id="rf-window" value="${value.evaluationWindowSeconds}">
      <label>Severity</label><select class="in" id="rf-sev">${['info', 'warning', 'critical']
        .map((s) => `<option value="${s}" ${value.severity === s ? 'selected' : ''}>${s}</option>`)
        .join('')}</select>
      <label>Cooldown (s)</label><input class="in" type="number" id="rf-cooldown" value="${value.cooldownSeconds}">
      <label>Enabled</label><div><input type="checkbox" id="rf-enabled" ${value.enabled ? 'checked' : ''}></div>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="bt" id="rf-cancel">Cancel</button><button class="bt pr" id="rf-save">${
      isEdit ? 'Save changes' : 'Create rule'
    }</button></div>`);
  $('#rf-cancel').addEventListener('click', closeModal);
  $('#rf-save').addEventListener('click', async () => {
    const payload = {
      name: $('#rf-name').value.trim(),
      metric: $('#rf-metric').value,
      operator: $('#rf-op').value,
      threshold: Number($('#rf-threshold').value),
      evaluationWindowSeconds: Number($('#rf-window').value),
      severity: $('#rf-sev').value,
      cooldownSeconds: Number($('#rf-cooldown').value),
      enabled: $('#rf-enabled').checked,
    };
    if (!payload.name) {
      toast('Rule name is required');
      return;
    }
    try {
      if (isEdit) await apiSend('PATCH', `/api/v1/alerts/${rule.id}`, payload);
      else await apiSend('POST', '/api/v1/alerts', payload);
      closeModal();
      await loadAlerts();
      rerender();
      toast(isEdit ? 'Rule updated' : 'Rule created');
    } catch (error) {
      reportError(error);
    }
  });
}

async function toggleRule(rule) {
  try {
    await apiSend('PATCH', `/api/v1/alerts/${rule.id}`, { enabled: !rule.enabled });
    await loadAlerts();
    rerender();
  } catch (error) {
    reportError(error);
  }
}

async function deleteRule(rule) {
  if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
  try {
    await apiSend('DELETE', `/api/v1/alerts/${rule.id}`);
    await loadAlerts();
    rerender();
    toast('Rule deleted');
  } catch (error) {
    reportError(error);
  }
}

async function testRule(rule) {
  try {
    await apiSend('POST', `/api/v1/alerts/${rule.id}/test`);
    toast(`Test notification dispatched for "${rule.name}"`);
    await loadAlerts();
    rerender();
  } catch (error) {
    reportError(error);
  }
}

PAGES.settings = {
  render() {
    const settings = state.settings || {};
    const server = state.server || {};
    const status = state.status || {};
    const metrics = state.metrics || {};
    return `<div class="pgw">
      <div class="ph2"><div><h2>Settings</h2><p>Retention, timeouts and notifications</p></div></div>

      <div class="card"><div class="sec">Server</div><div class="fm">
        <label>Name</label><div>${h(server.name || '—')}</div>
        <label>Address</label><div>${h(serverAddress() || '—')}</div>
        <label>Minecraft</label><div>${h(status.minecraftVersion || server.minecraftVersion || '—')}</div>
        <label>Software</label><div>${h(status.software || server.software || '—')}</div>
      </div></div>

      <div class="card"><div class="sec">Monitoring &amp; retention</div><div class="fm" id="setForm">
        <label>Raw metrics (days)</label><input class="in" type="number" id="st-raw" value="${settings.retentionRawMetricsDays ?? 7}">
        <label>1m aggregates (days)</label><input class="in" type="number" id="st-1m" value="${settings.retentionAggregated1mDays ?? 30}">
        <label>1h aggregates (days)</label><input class="in" type="number" id="st-1h" value="${settings.retentionAggregated1hDays ?? 365}">
        <label>Events (days)</label><input class="in" type="number" id="st-ev" value="${settings.retentionEventsDays ?? 90}">
        <label>Player sessions (days)</label><input class="in" type="number" id="st-sess" value="${settings.retentionPlayerSessionsDays ?? 365}">
        <label>Heartbeat stale (s)</label><input class="in" type="number" id="st-stale" value="${settings.heartbeatStaleSeconds ?? 30}">
        <label>Heartbeat offline (s)</label><input class="in" type="number" id="st-off" value="${settings.heartbeatOfflineSeconds ?? 60}">
      </div>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="bt pr" data-act="save-settings">Save changes</button></div></div>

      <div class="card"><div class="sec">Notifications</div><div class="fm">
        <label>Discord webhook</label><div>${
          settings.discordConfigured
            ? '<span class="bx s">Configured</span>'
            : '<span class="bx x">Not configured</span> <span class="m">set DISCORD_WEBHOOK_URL on the API</span>'
        }</div>
        <label>Delivery</label><div class="m">Alert notifications are sent by the API, never from the browser.</div>
      </div></div>

      <div class="card"><div class="sec">Agent</div>${rows([
        ['Connectivity', status.agentConnected ? '<span class="g">● Connected</span>' : '<span style="color:#ef4444">● Disconnected</span>'],
        ['Agent version', h(metrics.agentVersion || '—')],
        ['Last heartbeat', status.lastHeartbeatAt ? `${F.ago(status.lastHeartbeatAt)} (${F.dateTime(status.lastHeartbeatAt)})` : '—'],
        ['Data freshness', status.dataFreshnessSeconds == null ? '—' : `${status.dataFreshnessSeconds}s`],
      ])}</div>

      <div class="card"><div class="sec">Export</div><div class="row">
        <button class="bt" data-act="export-metrics">Metrics CSV (${ui.range})</button>
        <button class="bt" data-act="export-events">Events CSV</button>
      </div></div>
    </div>`;
  },
  mount() {
    /* Save is handled by the single delegated listener in setupGlobalActions(). */
  },
};

async function saveSettings() {
  const payload = {
    retentionRawMetricsDays: Number($('#st-raw').value),
    retentionAggregated1mDays: Number($('#st-1m').value),
    retentionAggregated1hDays: Number($('#st-1h').value),
    retentionEventsDays: Number($('#st-ev').value),
    retentionPlayerSessionsDays: Number($('#st-sess').value),
    heartbeatStaleSeconds: Number($('#st-stale').value),
    heartbeatOfflineSeconds: Number($('#st-off').value),
  };
  try {
    state.settings = await apiSend('PATCH', API.settings, payload);
    toast('Settings saved');
    rerender();
  } catch (error) {
    reportError(error);
  }
}

/* ------------------------------------------------------------------ *
 * Player profile page
 * ------------------------------------------------------------------ */

const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'];

/** Human labels for Bukkit damage causes shown in the deaths donut. */
const DEATH_LABELS = {
  PLAYER_KILL: 'Slain by player',
  ENTITY_ATTACK: 'Melee',
  ENTITY_SWEEP_ATTACK: 'Sweep',
  PROJECTILE: 'Projectile',
  FALL: 'Fall',
  VOID: 'Void',
  LAVA: 'Lava',
  FIRE: 'Fire',
  FIRE_TICK: 'Burning',
  DROWNING: 'Drowning',
  SUFFOCATION: 'Suffocation',
  STARVATION: 'Starvation',
  POISON: 'Poison',
  MAGIC: 'Magic',
  WITHER: 'Wither',
  EXPLOSION: 'Explosion',
  ENTITY_EXPLOSION: 'Explosion',
  BLOCK_EXPLOSION: 'Explosion',
  CONTACT: 'Contact',
  CRAMMING: 'Cramming',
  FLY_INTO_WALL: 'Kinetic',
  FALLING_BLOCK: 'Falling block',
  LIGHTNING: 'Lightning',
  THORNS: 'Thorns',
  DRAGON_BREATH: 'Dragon breath',
  HOT_FLOOR: 'Magma',
  FREEZE: 'Freeze',
  SONIC_BOOM: 'Sonic boom',
  UNKNOWN: 'Unknown',
};

function deathLabel(cause) {
  if (DEATH_LABELS[cause]) return DEATH_LABELS[cause];
  return String(cause || 'Unknown')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Entry point used everywhere a player name or row is clicked. */
function openPlayer(uuid) {
  ui.profile.uuid = uuid;
  ui.profile.reason = '';
  ui.profile.message = '';
  ui.profile.note = '';
  ui.profile.broadcast = '';
  profileData = null;
  go('profile');
}

const ACTION_LABELS = {
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  op: 'Make OP',
  deop: 'Remove OP',
  gamemode: 'Gamemode change',
  teleport: 'Teleport',
  message: 'Private message',
  warn: 'Warning',
  mute: 'Mute',
  unmute: 'Unmute',
  broadcast: 'Broadcast',
};

/** Badge tone per verb so the audit trail is colour-coded at a glance. */
const ACTION_TONE = {
  warn: 'w',
  mute: 'w',
  broadcast: 's',
  unmute: 's',
  unban: 's',
  message: 'i',
  op: 'i',
  deop: 'i',
  gamemode: 'i',
  teleport: 'i',
  kick: 'c',
  ban: 'c',
};

/** Tone for one action row: failures always read red, otherwise by verb. */
function actionTone(action) {
  if (!action) return 'x';
  if (action.status === 'failed') return 'c';
  return ACTION_TONE[action.action] || 'x';
}

/** One row in the profile's "Recent actions" list. */
function actionRow(a) {
  const text =
    a.resultMessage ||
    a.detail ||
    (a.status === 'pending' ? 'Queued' : a.status === 'sent' ? 'Executing…' : '—');
  return `<div class="tr"><span class="bx ${actionTone(a)}">${h(a.action)}</span><span style="flex:1">${h(
    text,
  )}</span><span class="m">${F.ago(a.createdAt)}</span></div>`;
}

/** The "Recent actions" block, re-rendered on its own when actions change. */
function renderActionLines() {
  const items = (profileData?.actions?.items || []).slice(0, 6);
  if (!items.length) return '';
  return `<div class="ct" style="margin-top:10px">Recent actions</div>${items.map(actionRow).join('')}`;
}

/** Patch just the actions list so a queued/completed action appears instantly. */
function drawProfileActions() {
  const host = $('#pfActions');
  if (host) host.innerHTML = renderActionLines();
}

/** Immediately show a just-queued action; the socket confirms it shortly after. */
function showQueuedAction(action) {
  if (!action || !profileData || ui.page !== 'profile') return;
  if (action.playerUuid && action.playerUuid !== ui.profile.uuid) return;
  const items = (profileData.actions?.items || []).filter((a) => a.id !== action.id);
  profileData.actions = { ...(profileData.actions || {}), items: [action, ...items].slice(0, 12) };
  drawProfileActions();
}

async function loadProfile(options = {}) {
  const uuid = ui.profile.uuid;
  const box = $('#pfb');
  if (!uuid || !box) return;
  if (!options.silent) box.innerHTML = empty('Loading player…');
  try {
    const [detail, sessions, activity, deaths, actions] = await Promise.all([
      apiGet(API.player(uuid)),
      apiGet(API.sessions(uuid, { pageSize: 12 })),
      apiGet(API.playerActivity(uuid, 14)),
      apiGet(API.playerDeaths(uuid, 30)).catch(() => ({ uuid, total: 0, causes: [] })),
      apiGet(API.actions({ playerUuid: uuid, limit: 12 })).catch(() => ({ items: [] })),
    ]);
    ui.profile.gamemode = detail.gamemode || 'survival';
    profileData = { uuid, detail, sessions, activity: activity?.days || [], deaths, actions };
    drawProfile();
  } catch (error) {
    box.innerHTML = `<div class="card">${h(error?.message || 'Could not load this player')}</div>`;
    if (!(error instanceof ApiError && error.status === 404)) reportError(error);
  }
}

function drawProfile() {
  const box = $('#pfb');
  if (!box) return;
  if (!profileData) {
    box.innerHTML = empty('Loading player…');
    return;
  }
  const p = profileData.detail;
  if (!p) {
    box.innerHTML = `<div class="card">Player not found</div>`;
    return;
  }

  const admin = isAdmin();
  const online = Boolean(p.online);
  const badge = (tone, text) => `<span class="bx ${tone}">${text}</span>`;
  /** Disables a control unless the caller is an admin (and the target is online). */
  const gate = (needsOnline) => {
    if (!admin) return disAttr(true);
    if (needsOnline && !online) return disAttr(true, 'Player must be online');
    return '';
  };

  const banLine = p.banned
    ? `<div class="tr"><span class="bx c">Banned</span><span style="flex:1">${h(
        p.banReason || 'No reason given',
      )}</span><span class="m">${
        p.banExpiresAt ? `until ${F.dateTime(p.banExpiresAt)}` : 'permanent'
      }${p.banSource ? ` · ${h(p.banSource)}` : ''}</span></div>`
    : '';

  const head = `<div class="card" style="margin-bottom:12px">
    <div class="row" style="gap:14px;align-items:flex-start">
      ${avatar(p.uuid, 60, 8, p.lastKnownUsername)}
      <div style="flex:1;min-width:0">
        <h2 style="font-size:20px;margin:0 0 4px">${h(p.lastKnownUsername)} ${badge(
          online ? 's' : 'x',
          online ? 'Online' : 'Offline',
        )}${p.operator ? ` ${badge('i', 'OP')}` : ''}${p.banned ? ` ${badge('c', 'Banned')}` : ''}${
          p.muted ? ` ${badge('w', 'Muted')}` : ''
        }</h2>
        <div class="m" style="font-family:monospace">${h(p.uuid)}</div>
        <div class="m">${
          p.firstSeenAt ? `First seen ${F.dateOnly(p.firstSeenAt)} · ` : ''
        }${online ? 'online now' : p.lastSeenAt ? `last seen ${F.ago(p.lastSeenAt)}` : 'no recorded sessions'}</div>
        <div class="m">${
          online
            ? `${h(p.world || '—')} · ${h(p.gamemode || '—')}${
                p.clientBrand ? ` · ${h(p.clientBrand)}` : ''
              }${p.position ? ` · x ${Math.round(p.position.x)} y ${Math.round(p.position.y)} z ${Math.round(p.position.z)}` : ''}`
            : 'Live attributes (world, ping, gamemode, position, health) appear only while the player is online.'
        }</div>
      </div>
    </div>
    <div class="row" style="margin-top:12px;flex-wrap:wrap">
      <input class="in" id="pfReason" placeholder="Reason (warn / kick / ban)" value="${h(
        ui.profile.reason,
      )}" style="width:230px">
      <button class="bt" data-pf="warn"${gate(false)}>Warn</button>
      <button class="bt" data-pf="${p.muted ? 'unmute' : 'mute'}"${gate(false)}>${
        p.muted ? 'Unmute' : 'Mute'
      }</button>
      ${online ? `<button class="bt" data-pf="kick"${gate(true)}>Kick</button>` : ''}
      <button class="bt dn" data-pf="${p.banned ? 'unban' : 'ban'}"${gate(false)}>${
        p.banned ? 'Unban' : 'Ban'
      }</button>
      <button class="bt" data-pf="${p.operator ? 'deop' : 'op'}"${gate(false)}>${
        p.operator ? 'Remove OP' : 'Make OP'
      }</button>
    </div>
    <div class="row" style="margin-top:10px;flex-wrap:wrap">
      <span class="m">Gamemode</span>
      ${selectHTML('pfGm', GAMEMODES.map((g) => [g, g]), ui.profile.gamemode)}
      <button class="bt" data-pf="gamemode"${gate(true)}>Apply</button>
      <button class="bt" data-pf="teleport"${gate(true)}>Teleport to spawn</button>
    </div>
    <div class="row" style="margin-top:10px">
      <input class="in" id="pfMsg" placeholder="Send a private message" value="${h(
        ui.profile.message,
      )}" style="flex:1"${online ? '' : ' disabled title="Player must be online"'}>
      <button class="bt" data-pf="message"${gate(true)}>Send</button>
    </div>
    <div class="row" style="margin-top:10px">
      <input class="in" id="pfBc" placeholder="Broadcast to the whole server" value="${h(
        ui.profile.broadcast,
      )}" style="flex:1"${disAttr(!admin)}>
      <button class="bt pr" data-pf="broadcast"${disAttr(!admin)}>Broadcast</button>
    </div>
  </div>`;

  const avgSession = p.sessionCount ? p.totalPlaytimeSeconds / p.sessionCount : null;
  // Death causes are only recorded while the agent is running, but the server's
  // own death statistic is lifetime. Prefer the lifetime figure so the KPI and
  // the donut agree, then reconcile the difference below.
  const lifetimeDeaths = typeof p.deaths === 'number' ? p.deaths : null;
  const recordedCauses = (profileData.deaths?.causes || []).map((c) => [deathLabel(c.cause), c.count]);
  const recordedDeathTotal = recordedCauses.reduce((sum, [, v]) => sum + v, 0);
  const deathTotal = lifetimeDeaths ?? (recordedDeathTotal || profileData.deaths?.total || null);
  const kpis = `<div class="kp6">
    ${kpi('Playtime', F.duration(p.totalPlaytimeSeconds))}
    ${kpi('Sessions', F.num(p.sessionCount))}
    ${kpi('Avg session', avgSession == null ? '—' : F.duration(avgSession))}
    ${kpi('Deaths', deathTotal == null ? '—' : F.num(deathTotal))}
    ${kpi('Ping', online && p.pingMs != null ? `${p.pingMs} ms` : '—')}
    ${kpi('Last seen', online ? 'now' : p.lastSeenAt ? F.ago(p.lastSeenAt) : '—')}
  </div>`;

  const days = profileData.activity || [];
  const hours = days.map((d) => (d.seconds || 0) / 3600);
  const dayMax = Math.max(1, ...hours);
  const totalHours = hours.reduce((sum, v) => sum + v, 0);
  const playChart = hours.length
    ? `${columnChart(hours, dayMax, () => '#22c55e')}<div class="xl" style="padding-left:0"><span>${h(
        days[0]?.day || '',
      )}</span><span>${h(days[Math.floor(days.length / 2)]?.day || '')}</span><span>${h(
        days[days.length - 1]?.day || '',
      )}</span></div>`
    : empty('No playtime recorded in the last 14 days');

  const sessions = profileData.sessions?.items || [];
  const sessionRows = sessions.length
    ? sessions
        .map(
          (s) =>
            `<tr><td class="m">${F.dateTime(s.joinedAt)}</td><td>${
              s.leftAt ? `<span class="m">${F.dateTime(s.leftAt)}</span>` : '<span class="bx s">online</span>'
            }</td><td class="mp-num">${
              s.durationSeconds == null ? '—' : F.duration(s.durationSeconds)
            }</td></tr>`,
        )
        .join('')
    : `<tr><td class="m" colspan="3">No sessions recorded</td></tr>`;

  // Deaths that happened before the agent began tracking can't be attributed
  // to a cause, so show them explicitly instead of hiding the gap.
  const untrackedDeaths =
    lifetimeDeaths != null ? Math.max(0, lifetimeDeaths - recordedDeathTotal) : 0;
  const deathSlices = untrackedDeaths
    ? [...recordedCauses, ['Not tracked', untrackedDeaths, '#5b6b7a']]
    : recordedCauses;
  const deathsCard = deathSlices.length
    ? `<div class="cc">${donut(
        deathSlices,
        F.num(deathTotal ?? deathSlices.reduce((sum, [, v]) => sum + v, 0)),
        'deaths',
        118,
        15,
      )}${legend(deathSlices, (v) => F.num(v))}</div>${
        untrackedDeaths
          ? `<div class="m" style="padding:6px 0 0">Cause tracking starts with the MinePulse agent; ${F.num(
              untrackedDeaths,
            )} earlier death${untrackedDeaths === 1 ? '' : 's'} can't be attributed.</div>`
          : ''
      }`
    : empty('No deaths recorded yet');

  const notes = p.notes || [];
  const warnings = notes.filter((n) => n.kind === 'warning');
  const warnLines = warnings.length
    ? warnings
        .map(
          (w) =>
            `<div class="tr"><span class="bx w">Warn</span><span style="flex:1">${h(
              w.body,
            )}</span><span class="m">${F.ago(w.createdAt)}</span></div>`,
        )
        .join('')
    : p.banned
      ? ''
      : '<div class="m" style="padding:4px 0">No active warnings</div>';

  const actionLines = `<div id="pfActions">${renderActionLines()}</div>`;

  const staffNotes = notes.filter((n) => n.kind === 'note');
  const noteLines = staffNotes.length
    ? staffNotes
        .map(
          (n) =>
            `<div class="tr" style="display:block"><div>${h(n.body)}</div><div class="m">${h(
              n.author,
            )} · ${F.ago(n.createdAt)}</div></div>`,
        )
        .join('')
    : '<div class="m" style="padding:4px 0">No notes yet</div>';

  box.innerHTML = `${head}${kpis}
    <div class="g12" style="margin-top:12px">
      <div class="s8">
        <div class="card" style="margin-bottom:12px">
          <div class="ct">Playtime <small>last 14 days · ${totalHours.toFixed(1)} h</small></div>
          ${playChart}
        </div>
        <div class="card">
          <div class="ct">Session history <small>most recent ${sessions.length}</small></div>
          <table class="t"><thead><tr><th>Joined</th><th>Left</th><th class="mp-num">Duration</th></tr></thead><tbody>${sessionRows}</tbody></table>
        </div>
      </div>
      <div class="s4">
        <div class="card" style="margin-bottom:12px">
          <div class="ct">Deaths by cause <small>${untrackedDeaths ? 'lifetime' : 'last 30 days'}</small></div>
          ${deathsCard}
        </div>
        <div class="card" style="margin-bottom:12px">
          <div class="ct">Warnings and bans</div>
          ${banLine}${warnLines}${actionLines}
        </div>
        <div class="card">
          <div class="ct">Staff notes</div>
          <input class="in" id="pfNote" placeholder="Add a note, press Enter" value="${h(
            ui.profile.note,
          )}" style="width:100%;margin-bottom:8px"${disAttr(!admin)}>
          ${noteLines}
        </div>
      </div>
    </div>`;
}

/** Prompts for a moderation reason and returns it, or null when cancelled. */
function promptReason(prompt) {
  const value = window.prompt(prompt, '');
  if (value == null) return null;
  return value.trim();
}

async function runProfileAction(action) {
  const uuid = ui.profile.uuid;
  if (!uuid) return;
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }

  const body = { action };
  if (action === 'warn') {
    const reason = $('#pfReason')?.value.trim() || ui.profile.reason.trim();
    if (!reason) {
      toast('Enter a reason for the warning');
      return;
    }
    body.reason = reason;
  } else if (action === 'kick' || action === 'ban') {
    const reason = $('#pfReason')?.value.trim();
    if (reason) body.reason = reason;
    else {
      const prompted = promptReason(`Reason for ${action} (optional)`);
      if (prompted) body.reason = prompted;
    }
  } else if (action === 'gamemode') {
    body.mode = $('#pfGm')?.value || ui.profile.gamemode;
  } else if (action === 'message') {
    const text = $('#pfMsg')?.value.trim();
    if (!text) {
      toast('Enter a message first');
      return;
    }
    body.text = text;
  } else if (action === 'broadcast') {
    await sendBroadcast($('#pfBc')?.value);
    return;
  }

  try {
    const res = await apiSend('POST', API.playerAction(uuid), body);
    if (action === 'warn' || action === 'kick' || action === 'ban') {
      ui.profile.reason = '';
      const input = $('#pfReason');
      if (input) input.value = '';
    }
    if (action === 'message') {
      ui.profile.message = '';
      const input = $('#pfMsg');
      if (input) input.value = '';
    }
    toast(`${ACTION_LABELS[action] || action} queued`);
    // Show the queued action immediately; the socket confirms it within seconds.
    showQueuedAction(res?.action);
    // Mute/unmute are synced flags, not queued actions — refresh to reflect them.
    if (!res?.action) await loadProfile({ silent: true });
  } catch (error) {
    reportError(error);
  }
}

async function addProfileNote(body) {
  const uuid = ui.profile.uuid;
  const text = String(body || '').trim();
  if (!uuid || !text) return;
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  try {
    await apiSend('POST', API.playerNotes(uuid), { kind: 'note', body: text });
    ui.profile.note = '';
    toast('Note added');
    await loadProfile();
  } catch (error) {
    reportError(error);
  }
}

async function runRowAction(action, uuid) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  const body = { action };
  if (action === 'ban') {
    const reason = promptReason(`Reason for banning this player (optional)`);
    if (reason) body.reason = reason;
  }
  try {
    await apiSend('POST', API.playerAction(uuid), body);
    toast(`${ACTION_LABELS[action] || action} queued`);
    await loadPlayersAll();
    drawPlayersPage();
  } catch (error) {
    reportError(error);
  }
}

async function runBulkAction(action) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  const uuids = Object.keys(ui.players.selected).filter((k) => ui.players.selected[k]);
  if (!uuids.length) {
    toast('Select at least one player first');
    return;
  }
  const body = { action };
  if (action === 'ban') {
    const reason = promptReason(`Reason for banning ${uuids.length} player(s) (optional)`);
    if (reason) body.reason = reason;
  }
  const results = await Promise.allSettled(
    uuids.map((uuid) => apiSend('POST', API.playerAction(uuid), body)),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  toast(`${ok}/${uuids.length} ${ACTION_LABELS[action] || action} action(s) queued`);
  ui.players.selected = {};
  await loadPlayersAll();
  drawPlayersPage();
}

async function sendBroadcast(message) {
  const text = String(message ?? '').trim();
  if (!text) {
    toast('Enter a broadcast message');
    return;
  }
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  try {
    await apiSend('POST', API.broadcast, { message: text });
    ui.profile.broadcast = '';
    const pageInput = $('#bc');
    if (pageInput) pageInput.value = '';
    const profileInput = $('#pfBc');
    if (profileInput) profileInput.value = '';
    toast('Broadcast queued');
  } catch (error) {
    reportError(error);
  }
}

const PROFILE_ACTION_HANDLERS = new Set([
  'warn',
  'mute',
  'unmute',
  'kick',
  'ban',
  'unban',
  'op',
  'deop',
  'gamemode',
  'teleport',
  'message',
  'broadcast',
]);

PAGES.profile = {
  render() {
    return `<div class="pgw">
      <div class="ph2"><div><h2>Player profile</h2><p>Live status, history and moderation</p></div>
        <div class="tools"><button class="bt" id="pfBack">‹ Back to players</button></div></div>
      <div id="pfb"></div>
    </div>`;
  },
  mount(root) {
    $('#pfBack', root)?.addEventListener('click', () => go('players'));

    const box = $('#pfb', root);
    box.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-pf]');
      if (!btn || btn.disabled) return;
      const action = btn.dataset.pf;
      if (PROFILE_ACTION_HANDLERS.has(action)) runProfileAction(action);
    });
    box.addEventListener('input', (event) => {
      const id = event.target.id;
      if (id === 'pfReason') ui.profile.reason = event.target.value;
      else if (id === 'pfMsg') ui.profile.message = event.target.value;
      else if (id === 'pfBc') ui.profile.broadcast = event.target.value;
      else if (id === 'pfNote') ui.profile.note = event.target.value;
    });
    box.addEventListener('change', (event) => {
      if (event.target.id === 'pfGm') ui.profile.gamemode = event.target.value;
    });
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const id = event.target.id;
      if (id === 'pfNote') addProfileNote(event.target.value);
      else if (id === 'pfMsg') runProfileAction('message');
      else if (id === 'pfBc') runProfileAction('broadcast');
      else if (id === 'pfReason') runProfileAction('warn');
    });

    if (profileData && profileData.uuid === ui.profile.uuid) drawProfile();
    else loadProfile();
  },
};

/* ------------------------------------------------------------------ *
 * Detail modals
 * ------------------------------------------------------------------ */
function openEvent(evt) {
  modal(`<h3><span class="bx ${F.SEVERITY_TONE[evt.severity] || 'i'}">${evt.severity}</span> ${h(evt.summary)}</h3>
    <div class="m">${h(evt.eventType)}</div>
    ${rows([
      ['Occurred', F.dateTime(evt.occurredAt)],
      ['Received', F.dateTime(evt.receivedAt)],
      ['Request', h(evt.requestId || '—')],
    ])}
    ${evt.details ? `<div class="mp-code">${h(JSON.stringify(evt.details, null, 2))}</div>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="bt pr" onclick="document.getElementById('md').innerHTML=''">Close</button></div>`);
}

/* ------------------------------------------------------------------ *
 * Router + rerender
 * ------------------------------------------------------------------ */

function rerender() {
  renderChrome();
  if (ui.page === 'overview') {
    renderOverview();
    return;
  }
  const view = $('#views');
  const page = PAGES[ui.page];
  if (!page) return;
  const scroll = window.scrollY;
  const active = document.activeElement;
  const activeId = active && active.id;
  const selection = active && active.selectionStart;
  view.innerHTML = page.render();
  page.mount(view);
  window.scrollTo(0, scroll);
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el && el.focus) {
      el.focus();
      if (selection != null && el.setSelectionRange) {
        try {
          el.setSelectionRange(selection, selection);
        } catch {
          /* input type does not support selection */
        }
      }
    }
  }
}

function go(pageName) {
  ui.page = pageName;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === pageName));
  const wrap = $('#wrap');
  const view = $('#views');
  if (pageName === 'overview') {
    wrap.style.display = '';
    view.innerHTML = '';
    renderOverview();
  } else {
    wrap.style.display = 'none';
    view.innerHTML = '';
    const page = PAGES[pageName];
    if (page) {
      view.innerHTML = page.render();
      page.mount(view);
    }
  }
  closePops();
  window.scrollTo(0, 0);
}

function scheduleRerender() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => rerender(), 250);
}

function renderChrome() {
  renderHero();
  updateBadges();
}

function updateBadges() {
  const open = (state.alerts.incidents || []).filter((i) => i.status === 'open').length;
  const badge = $('#nav .bd');
  if (badge) {
    badge.textContent = open;
    badge.style.display = open ? '' : 'none';
  }
  const bell = $('#belln');
  if (bell) {
    bell.textContent = open;
    bell.style.display = open ? '' : 'none';
  }
}

/* ------------------------------------------------------------------ *
 * Chrome: nav, search, notifications, user menu, theme, clock
 * ------------------------------------------------------------------ */

function renderNav() {
  $('#nav').innerHTML = NAV.map(
    ([icon, label, page]) =>
      `<a data-page="${page}">${ic(icon)}${label}${page === 'alerts' ? '<span class="bd" style="display:none">0</span>' : ''}</a>`,
  ).join('');
  $('#nav').addEventListener('click', (event) => {
    const link = event.target.closest('a[data-page]');
    if (link) go(link.dataset.page);
  });
}

function setupSearch() {
  const box = $('#sr');
  const input = $('#q');
  const run = () => {
    const value = input.value.trim().toLowerCase();
    if (!value) {
      box.style.display = 'none';
      box._results = [];
      return;
    }
    const results = [];
    (state.playersAll.length ? state.playersAll : state.playersOnline)
      .filter((p) => p.lastKnownUsername.toLowerCase().includes(value))
      .slice(0, 4)
      .forEach((p) => results.push(['Player', p.lastKnownUsername, 'players']));
    (state.plugins?.plugins || [])
      .filter((p) => p.pluginName.toLowerCase().includes(value))
      .slice(0, 4)
      .forEach((p) => results.push(['Plugin', p.pluginName, 'plugins']));
    state.eventsRecent
      .filter((e) => e.summary.toLowerCase().includes(value))
      .slice(0, 3)
      .forEach((e) => results.push(['Event', e.summary, 'events']));
    box._results = results;
    box.innerHTML = results.map((r, i) => `<div data-i="${i}"><span class="m">${r[0]}</span> &nbsp;${h(r[1])}</div>`).join('') || '<div class="m">No results</div>';
    box.style.display = 'block';
  };
  input.addEventListener('input', run);
  input.addEventListener('blur', () => setTimeout(() => (box.style.display = 'none'), 150));
  box.addEventListener('mousedown', (event) => {
    const item = event.target.closest('[data-i]');
    if (!item) return;
    const result = box._results[Number(item.dataset.i)];
    input.value = '';
    box.style.display = 'none';
    if (result) go(result[2]);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input.focus();
    }
  });
}

function closePops() {
  const np = $('#np');
  const um = $('#um');
  if (np) np.style.display = 'none';
  if (um) um.style.display = 'none';
}

function setupNotifications() {
  const np = $('#np');
  $('#bell').addEventListener('click', (event) => {
    event.stopPropagation();
    const open = np.style.display === 'block';
    closePops();
    if (open) return;
    const openIncidents = (state.alerts.incidents || []).filter((i) => i.status === 'open');
    const critical = state.eventsRecent.filter((e) => e.severity !== 'info').slice(0, 5);
    np.innerHTML = `<div class="row" style="padding:6px 8px"><b>Notifications</b></div>${
      openIncidents
        .map(
          (i) => `<div class="ni mp-click" data-go="alerts"><i style="background:${
            { critical: '#ef4444', warning: '#f5b82e', info: '#38bdf8' }[i.ruleSeverity] || '#f5b82e'
          }"></i><div><b>${h(i.ruleName)}</b><small>${h(i.summary)} · ${F.ago(i.startedAt)}</small></div></div>`,
        )
        .join('') ||
      critical
        .map(
          (e) => `<div class="ni mp-click" data-go="events"><i style="background:${
            e.severity === 'critical' ? '#ef4444' : '#f5b82e'
          }"></i><div><b>${h(e.summary)}</b><small>${F.ago(e.occurredAt)}</small></div></div>`,
        )
        .join('') ||
      '<div class="m" style="padding:16px;text-align:center">You are all caught up</div>'
    }`;
    np.querySelectorAll('[data-go]').forEach((el) =>
      el.addEventListener('click', () => {
        closePops();
        go(el.dataset.go);
      }),
    );
    np.style.display = 'block';
  });
}

function setupUserMenu() {
  const um = $('#um');
  $('#ad').addEventListener('click', (event) => {
    event.stopPropagation();
    const open = um.style.display === 'block';
    closePops();
    if (open || !state.user) return;
    um.innerHTML = `<div style="padding:8px"><b>${h(state.user.email)}</b><div class="bx i" style="display:inline-block;margin:6px 0">${h(
      state.user.role,
    )}</div></div><button class="bt" style="width:100%" id="st-signout">Sign out</button>`;
    um.querySelector('#st-signout').addEventListener('click', logout);
    um.style.display = 'block';
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#np,#um,#bell,#ad')) closePops();
  });
}

function setupTheme() {
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('mp_theme', theme);
    } catch {
      /* storage disabled */
    }
  };
  let stored = 'dark';
  try {
    stored = localStorage.getItem('mp_theme') || 'dark';
  } catch {
    stored = 'dark';
  }
  apply(stored);
  $('#themeMoon').addEventListener('click', () => apply('dark'));
  $('#themeSun').addEventListener('click', () => apply('light'));
}

function setupClock() {
  const tick = () => {
    const now = new Date();
    $('#clk').textContent = now.toTimeString().slice(0, 5);
    $('#dt').textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  tick();
  setInterval(tick, 1000);
}

function setupCollapse() {
  let min = false;
  try {
    min = localStorage.getItem('mp_min') === '1';
  } catch {
    min = false;
  }
  document.body.classList.toggle('mp-min', min);
  $('#collapseBtn').addEventListener('click', () => {
    min = !min;
    document.body.classList.toggle('mp-min', min);
    try {
      localStorage.setItem('mp_min', min ? '1' : '0');
    } catch {
      /* storage disabled */
    }
  });
}

/* ------------------------------------------------------------------ *
 * Overview interactions + quick actions
 * ------------------------------------------------------------------ */

function setupOverviewInteractions() {
  $('#tabs').addEventListener('click', (event) => {
    const span = event.target.closest('span[data-r]');
    if (!span) return;
    ui.range = span.dataset.r;
    $$('#tabs span').forEach((s) => s.classList.toggle('on', s.dataset.r === ui.range));
    loadHistory(ui.range).then(() => renderCharts('#cg', 'o')).catch(reportError);
  });

  $('#ovPtb').addEventListener('click', (event) => {
    const span = event.target.closest('span[data-k]');
    if (!span) return;
    ui.ovPlayersTab = span.dataset.k;
    $$('#ovPtb span').forEach((s) => s.classList.toggle('on', s.dataset.k === ui.ovPlayersTab));
    renderOverviewPlayers();
  });

  $('#pt').addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-uuid]');
    if (row) openPlayer(row.dataset.uuid);
  });

  const to = (page) => () => go(page);
  $('#lnkPlayers').addEventListener('click', to('players'));
  $('#lnkPlugins').addEventListener('click', to('plugins'));
  $('#lnkAlerts').addEventListener('click', to('alerts'));
  $('#lnkEvents').addEventListener('click', to('events'));
  $('#lnkLogs').addEventListener('click', to('events'));
  $('#lnkHb').addEventListener('click', to('performance'));

  $('#copyAddr').addEventListener('click', () => copyAddress());
  $('#jnAddr').addEventListener('click', () => copyAddress());
  $('#refreshBtn').addEventListener('click', () => {
    const icon = $('#refreshBtn svg');
    if (icon) {
      icon.style.transition = 'transform .6s';
      icon.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        icon.style.transition = 'none';
        icon.style.transform = 'none';
      }, 650);
    }
    refreshAll(true);
  });

  $('#qa').addEventListener('click', (event) => {
    const item = event.target.closest('[data-act]');
    if (!item) return;
    handleAction(item.dataset.act);
  });

  $('#adm').addEventListener('click', (event) => event.stopPropagation());
}

function setupGlobalActions() {
  // Single delegated click handler for everything rendered inside #views.
  // Attached once: #views is a static element that survives page swaps, so
  // page-level handlers must NOT be bound here repeatedly.
  $('#views').addEventListener('click', (event) => {
    const ruleBtn = event.target.closest('[data-rule]');
    if (ruleBtn) {
      handleRuleAction(ruleBtn);
      return;
    }
    const btn = event.target.closest('[data-act]');
    if (btn) handleAction(btn.dataset.act);
  });
}

function handleRuleAction(el) {
  const rule = state.alerts.rules.find((r) => r.id === el.dataset.rule);
  if (!rule) return;
  const op = el.dataset.op;
  if (op === 'edit') openRuleForm(rule);
  else if (op === 'delete') deleteRule(rule);
  else if (op === 'test') testRule(rule);
  else if (op === 'toggle') toggleRule(rule);
}

function handleAction(action) {
  if (action === 'refresh') refreshAll(true);
  if (action === 'health') healthReport();
  if (action === 'export-metrics') exportMetrics();
  if (action === 'export-events') exportEvents();
  if (action === 'new-rule') openRuleForm(null);
  if (action === 'save-settings') saveSettings();
}

function copyAddress() {
  const address = serverAddress();
  if (!address) {
    toast('No server address configured');
    return;
  }
  navigator.clipboard?.writeText(address).then(
    () => toast('Address copied'),
    () => toast('Could not copy address'),
  );
}

function healthReport() {
  const sample = state.metrics?.sample || {};
  const metrics = state.metrics || {};
  const status = state.status || {};
  const system = status.system || {};
  const uptime = metrics.uptimeSeconds ?? status.uptimeSeconds ?? null;
  const score = healthScore();

  const cleanMs = (state.history[ui.range]?.points || [])
    .map((p) => p.mspt)
    .filter((v) => v != null)
    .map(Number);
  const lastMs = cleanMs.length ? cleanMs[cleanMs.length - 1] : sample.mspt;
  const tail = cleanMs.slice(-2);
  const avgTail = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : lastMs;
  const tpsFromMspt = (ms) => (ms && ms > 0 ? Math.min(20, 1000 / ms) : null);
  const tpsLine = [tpsFromMspt(lastMs), tpsFromMspt(avgTail), sample.tps1m, sample.tps5m, sample.tps15m]
    .map((v) => (v == null ? '—' : F.tps(v)))
    .join(' / ');
  const minMs = F.seriesMin(cleanMs);
  const maxMs = F.seriesMax(cleanMs);
  const medMs = F.percentile(cleanMs, 0.5);
  const p95 = F.percentile(cleanMs, 0.95);
  const gcLine =
    Array.isArray(sample.gc) && sample.gc.length
      ? sample.gc.map((g) => `${g.name} ${F.num(g.count)} (${F.fixed(g.totalMs, 0)} ms)`).join(', ')
      : 'not reported';
  const disk =
    system.diskTotalBytes != null
      ? `${system.diskUsableBytes != null ? F.gigabytes(system.diskUsableBytes) : '—'} free of ${F.gigabytes(system.diskTotalBytes)}`
      : 'not reported';
  const verdict = score >= 85 ? 'Server is healthy' : score >= 60 ? 'Server is under load' : 'Server is struggling';

  modal(`<h3>Server health report</h3>
    <div class="mp-code">Status: ${h(status.state || 'unknown')} (${h(status.reason || 'no reason')})
Agent: ${status.agentConnected ? 'connected' : 'disconnected'}
TPS (5s/10s/1m/5m/15m): ${tpsLine}
MSPT min/med/95%/max: ${minMs == null ? '—' : F.fixed(minMs, 1)} / ${medMs == null ? '—' : F.fixed(medMs, 1)} / ${
    p95 == null ? '—' : F.fixed(p95, 1)
  } / ${maxMs == null ? '—' : F.fixed(maxMs, 1)} ms
CPU: ${F.pct(sample.cpuUsagePercent)} process
Heap: ${sample.heapUsedBytes == null ? '—' : F.gigabytes(sample.heapUsedBytes)} of ${
    sample.heapMaxBytes == null ? '—' : F.gigabytes(sample.heapMaxBytes)
  }
GC: ${gcLine}
Disk: ${disk}
Entities / chunks: ${sample.entityCount == null ? '—' : F.num(sample.entityCount)} / ${
    sample.chunkCount == null ? '—' : F.num(sample.chunkCount)
  }
Players: ${metrics.playerCount ?? '—'} / ${metrics.maxPlayers ?? '—'}
Uptime: ${F.uptimeText(uptime)}
Overall health: ${score}%
Verdict: ${verdict}</div>
    <div class="row" style="justify-content:flex-end"><button class="bt pr" onclick="document.getElementById('md').innerHTML=''">Close</button></div>`);
}

async function exportMetrics() {
  try {
    await apiDownload(`/api/v1/export/metrics?range=${ui.range}`, `minepulse-metrics-${ui.range}.csv`);
    toast('Metrics export downloaded');
  } catch (error) {
    reportError(error);
  }
}

async function exportEvents() {
  try {
    const query = buildQuery({ severity: ui.events.severity, category: ui.events.category, search: ui.events.search });
    await apiDownload(`/api/v1/export/events${query}`, 'minepulse-events.csv');
    toast('Events export downloaded');
  } catch (error) {
    reportError(error);
  }
}

/* ------------------------------------------------------------------ *
 * Realtime
 * ------------------------------------------------------------------ */

function connectSocket() {
  socket = io(API_BASE, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
  socket.on('connect', () => {
    state.socketConnected = true;
    renderHealth();
  });
  socket.on('disconnect', () => {
    state.socketConnected = false;
    renderHealth();
  });
  socket.on(SOCKET.status, (status) => {
    state.status = status;
    scheduleRerender();
  });
  socket.on(SOCKET.metrics, (metrics) => {
    state.metrics = metrics;
    if (ui.page === 'overview' || ui.page === 'performance') scheduleRerender();
    else renderChrome();
  });
  socket.on(SOCKET.players, (payload) => {
    state.playersOnline = payload?.online || [];
    if (ui.page === 'overview') scheduleRerender();
    else if (ui.page === 'players') {
      Promise.all([loadPlayersAll(), loadPlayersAnalytics()])
        .then(() => drawPlayersPage())
        .catch(() => {});
    } else renderChrome();
  });
  socket.on(SOCKET.plugins, (snapshot) => {
    state.plugins = snapshot;
    if (ui.page === 'overview' || ui.page === 'plugins') scheduleRerender();
  });
  socket.on(SOCKET.event, (event) => {
    state.eventsRecent = [event, ...state.eventsRecent].slice(0, 40);
    if (ui.page === 'overview' || ui.page === 'events') scheduleRerender();
  });
  socket.on(SOCKET.action, (action) => {
    if (!action) return;
    const terminal = action.status === 'done' || action.status === 'failed';
    // Live-update the audit trail of the player currently open.
    if (ui.page === 'profile' && profileData && action.playerUuid === ui.profile.uuid) {
      const items = (profileData.actions?.items || []).filter((a) => a.id !== action.id);
      profileData.actions = { ...(profileData.actions || {}), items: [action, ...items].slice(0, 12) };
      drawProfileActions();
      // A finished action can change ban/mute/op/gamemode state; refresh quietly.
      if (terminal) loadProfile({ silent: true }).catch(() => {});
    }
    if (ui.page === 'players' && terminal) {
      loadPlayersAll().then(() => drawPlayersPage()).catch(() => {});
    }
  });
  socket.on(SOCKET.alertTriggered, (payload) => {
    toast(`Alert triggered: ${payload?.rule?.name || 'rule'}`);
    loadAlerts().then(() => scheduleRerender()).catch(() => {});
  });
  socket.on(SOCKET.alertResolved, (payload) => {
    toast(`Alert resolved: ${payload?.rule?.name || 'rule'}`);
    loadAlerts().then(() => scheduleRerender()).catch(() => {});
  });
}

/* ------------------------------------------------------------------ *
 * Auth + boot
 * ------------------------------------------------------------------ */

function reportError(error) {
  if (error instanceof ApiError && error.status === 401) {
    showLogin();
    return;
  }
  if (error instanceof ApiError && error.status === 403) {
    toast('Your account does not have permission for that');
    return;
  }
  toast(error?.message || 'Something went wrong');
}

function showLogin() {
  $('#lg2').style.display = 'grid';
  document.body.classList.add('mp-locked');
}

function hideLogin() {
  $('#lg2').style.display = 'none';
  document.body.classList.remove('mp-locked');
}

function setUser(user) {
  state.user = user;
  const name = user ? displayName(user) : 'Admin';
  $('#adName').textContent = `${name} · ${roleLabel(user?.role)}`;
  $('#admName').textContent = name;
  $('#admMail').textContent = user ? user.email : '';
}

async function refreshAll(showToast) {
  try {
    await loadCore();
    await Promise.all([loadHistory(ui.range), loadHistory24()]);
    await loadPlayersAll();
    rerender();
    if (showToast) toast('Data refreshed');
  } catch (error) {
    reportError(error);
  }
}

async function login(email, password) {
  const button = $('#lBtn');
  const errorEl = $('#lErr');
  errorEl.textContent = '';
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const response = await apiSend('POST', '/api/v1/auth/login', { email, password });
    setCsrfToken(response.csrfToken);
    setUser(response.user);
    hideLogin();
    await bootData();
  } catch (error) {
    errorEl.textContent = error instanceof ApiError && error.status === 401 ? 'Invalid email or password' : error.message || 'Sign in failed';
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
}

async function logout() {
  try {
    await apiSend('POST', '/api/v1/auth/logout');
  } catch {
    /* ignore */
  }
  setCsrfToken('');
  setUser(null);
  if (socket) socket.disconnect();
  closePops();
  closeModal();
  showLogin();
}

async function bootData() {
  await refreshAll(false);
  if (!socket) connectSocket();
}

async function boot() {
  renderNav();
  setupClock();
  setupTheme();
  setupCollapse();
  setupSearch();
  setupNotifications();
  setupUserMenu();
  setupOverviewInteractions();
  setupGlobalActions();

  $('#loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    login($('#le').value.trim(), $('#lp').value);
  });

  try {
    const me = await apiGet('/api/v1/auth/me');
    setCsrfToken(me.csrfToken);
    setUser(me.user);
    hideLogin();
    await bootData();
  } catch {
    showLogin();
  }
}

boot();
