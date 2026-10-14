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
  player: (uuid) => `/api/v1/server/players/${encodeURIComponent(uuid)}`,
  sessions: (uuid, query) => `/api/v1/server/players/${encodeURIComponent(uuid)}/sessions${buildQuery(query)}`,
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
  players: { search: '', tab: 'online', page: 1, pageSize: 25 },
  plugins: { search: '' },
  events: { search: '', severity: '', category: '', page: 1, pageSize: 25 },
  alerts: { tab: 'open' },
};

let socket = null;
let rerenderTimer = null;

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

function rangeTabs(id) {
  return `<div class="tabs" id="${id}">${RANGES.map(
    (r) => `<span data-r="${r}" class="${r === ui.range ? 'on' : ''}">${r}</span>`,
  ).join('')}</div>`;
}

function empty(message) {
  return `<div class="mp-empty">${h(message)}</div>`;
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
  state.playersAll = (await apiGet(API.players({ pageSize: 100 })))?.items || [];
}

async function loadPlayersPage() {
  const { search, page, pageSize, tab } = ui.players;
  const query = { page, pageSize, search };
  if (tab === 'online') query.onlineOnly = 'true';
  const data = await apiGet(API.players(query));
  state.playersPage = data;
  return data;
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
  $('#ovAddr').textContent = server.address || 'address not set';
  $('#ovMeta').textContent = [status.software || server.software, status.minecraftVersion || server.minecraftVersion]
    .filter(Boolean)
    .join(' · ') || 'Version unknown';
  $('#up').textContent = F.uptimeText(metrics.uptimeSeconds ?? status.uptimeSeconds);
  $('#upSince').textContent = status.lastHeartbeatAt ? `Last heartbeat ${F.ago(status.lastHeartbeatAt)}` : 'No heartbeat yet';
  $('#tel').textContent = status.lastTelemetryAt ? status.lastTelemetryAt && `${F.ago(status.lastTelemetryAt)}` : 'no data';
  $('#tel').classList.toggle('mp-online-pill', Boolean(status.lastTelemetryAt));

  $('#jnMotd').textContent = server.address ? `Connect with ${server.address}` : 'Server address not configured';

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

  const tagTone = tone === 'g' ? '' : `color:${tone === 'r' ? '#ef4444' : '#f5b82c'};border-color:currentColor;background:rgba(239,68,68,.08)`;
  const tagLabel = { g: 'Healthy', y: 'Warning', r: 'Attention' }[tone];

  const cards = [
    {
      icon: 'users',
      label: 'Players',
      value: pc == null ? '—' : pc,
      unit: maxp ? `/ ${maxp}` : '',
      sub: pcPct != null ? `<div class="bar"><i style="width:${pcPct}%"></i></div><span>${pcPct}%</span>` : `<span>${status.agentConnected ? 'awaiting heartbeat' : 'agent offline'}</span>`,
    },
    {
      icon: 'chart',
      label: 'TPS',
      value: F.tps(sample.tps1m),
      unit: '',
      sub: `<span class="g">1m ${F.tps(sample.tps1m)} &nbsp; 5m ${F.tps(sample.tps5m)} &nbsp; 15m ${F.tps(sample.tps15m)}</span>`,
    },
    {
      icon: 'doc',
      label: 'MSPT',
      value: sample.mspt == null ? '—' : F.fixed(sample.mspt, 1),
      unit: ' ms',
      sub: sample.mspt == null ? '<span>no sample</span>' : `<span class="g">${sample.mspt < 50 ? 'within tick budget' : 'above 50 ms budget'}</span>`,
    },
    {
      icon: 'memory',
      label: 'Memory (Heap)',
      value: usedGb,
      unit: maxGb === '—' ? '' : `/ ${maxGb}`,
      sub: heapPct != null ? `<div class="bar"><i style="width:${heapPct}%"></i></div><span>${F.pct(heapPct)}</span>` : '<span>no sample</span>',
    },
    {
      icon: 'cpu',
      label: 'CPU Usage',
      value: sample.cpuUsagePercent == null ? '—' : `${Math.round(sample.cpuUsagePercent)}%`,
      unit: '',
      sub: `<span class="g">${status.agentConnected ? 'agent connected' : 'agent offline'}</span><span style="margin-left:auto;text-align:right">${F.uptimeText(metrics.uptimeSeconds)}</span>`,
    },
  ];

  $('#stats').innerHTML = cards
    .map(
      (card, index) => `<div class="card st"><div class="ico">${ic(card.icon)}</div><div><small>${card.label}</small><div class="v">${card.value} <span>${card.unit}</span></div></div>${
        index ? `<span class="tag" style="${tagTone}">${tagLabel}</span>` : ''
      }<div class="sub">${card.sub}</div></div>`,
    )
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
        return `<tr class="mp-click" data-uuid="${h(p.uuid)}"><td><span class="pa" style="background:${colorFor(p.uuid)}"></span>${h(
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
    ['Minecraft', h(status.minecraftVersion || server.minecraftVersion || '—')],
    ['Software', h(status.software || server.software || '—')],
    ['Address', h(server.address || 'not set')],
    ['Agent', status.agentConnected ? `<span class="g">● Connected</span>` : `<span style="color:#ef4444">● Disconnected</span>`],
    ['Agent version', h(metrics.agentVersion || '—')],
    ['Last heartbeat', status.lastHeartbeatAt ? F.ago(status.lastHeartbeatAt) : '—'],
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

function playerRow(p, columns) {
  return `<tr class="mp-click" data-uuid="${h(p.uuid)}"><td><span class="pa" style="background:${colorFor(
    p.uuid,
  )}"></span>${h(p.lastKnownUsername)}</td><td class="m">${h(p.uuid.slice(0, 8))}…</td><td><span class="bx ${
    p.online ? 's' : 'x'
  }">${p.online ? 'Online' : 'Offline'}</span></td>${columns}</tr>`;
}

const PAGES = {};

PAGES.overview = {
  render: () => '',
  mount: () => {},
};

PAGES.performance = {
  render() {
    const name = state.server?.name || 'this server';
    return `<div class="pgw">
      <div class="ph2"><div><h2>Performance</h2><p>TPS, MSPT, memory and CPU for ${h(name)}</p></div><div class="tools">${rangeTabs(
        'ptabs',
      )}<button class="bt" data-act="health">Health report</button></div></div>
      <div class="kp" id="pk"></div>
      <div class="cg2" id="pf"></div>
      <div class="g12" id="pd"></div>
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

function drawPerformance() {
  const points = state.history[ui.range]?.points || [];
  const sample = state.metrics?.sample || {};
  const metrics = state.metrics || {};
  const tpsValues = points.map((p) => p.tps1m);
  const msptValues = points.map((p) => p.mspt);
  const cpuValues = points.map((p) => p.cpuUsagePercent);
  const heapValues = points.map((p) => (p.heapUsedBytes != null && p.heapMaxBytes ? (p.heapUsedBytes / p.heapMaxBytes) * 100 : null));

  const pk = $('#pk');
  if (pk) {
    pk.innerHTML = [
      ['Average TPS', F.tps(F.seriesAvg(tpsValues) ?? sample.tps1m)],
      ['Peak MSPT', msptValues.some((v) => v != null) ? F.mspt(F.seriesMax(msptValues)) : '—'],
      ['Average CPU', cpuValues.some((v) => v != null) ? F.pct(F.seriesAvg(cpuValues)) : '—'],
      ['Peak memory', heapValues.some((v) => v != null) ? F.pct(F.seriesMax(heapValues)) : '—'],
    ]
      .map(([label, value]) => kpi(label, value))
      .join('');
  }

  renderCharts('#pf', 'p');

  const pd = $('#pd');
  if (pd) {
    const server = state.server || {};
    const status = state.status || {};
    const plugins = state.plugins?.plugins || [];
    pd.innerHTML = `<div class="card s6"><div class="sec">System</div>${rows([
      ['Server name', h(server.name || '—')],
      ['Minecraft version', h(status.minecraftVersion || server.minecraftVersion || '—')],
      ['Server software', h(status.software || server.software || '—')],
      ['Server address', h(server.address || '—')],
      ['Uptime', F.uptimeText(metrics.uptimeSeconds ?? status.uptimeSeconds)],
      ['Agent version', h(metrics.agentVersion || '—')],
      ['Plugin count', plugins.length],
    ])}</div>
    <div class="card s6"><div class="sec">Plugin inventory</div>${
      plugins.length
        ? `<table class="t"><tbody>${plugins
            .slice()
            .sort((a, b) => a.pluginName.localeCompare(b.pluginName))
            .slice(0, 14)
            .map((p) => `<tr><td>${h(p.pluginName)}</td><td class="m">${h(p.version)}</td><td>${p.enabled ? '<span class="bx s">on</span>' : '<span class="bx x">off</span>'}</td></tr>`)
            .join('')}</tbody></table>`
        : empty('No plugin inventory yet')
    }</div>`;
  }
}

PAGES.players = {
  render() {
    const onlineCount = state.playersOnline.length;
    return `<div class="pgw">
      <div class="ph2"><div><h2>Players</h2><p>${onlineCount} online · every player the agent has seen</p></div><div class="tools">
        <input class="in" id="psearch" placeholder="Search players" value="${h(ui.players.search)}">
        <div class="tabs" id="ptb"><span data-k="online" class="${ui.players.tab === 'online' ? 'on' : ''}">Online</span><span data-k="all" class="${
          ui.players.tab === 'all' ? 'on' : ''
        }">All</span><span data-k="top" class="${ui.players.tab === 'top' ? 'on' : ''}">Top</span></div>
      </div></div>
      <div class="card"><table class="t" id="ptab"></table></div>
      <div class="mp-pager" id="ppager"></div>
    </div>`;
  },
  mount(root) {
    const search = $('#psearch', root);
    let timer = null;
    search.addEventListener('input', () => {
      ui.players.search = search.value.trim();
      ui.players.page = 1;
      clearTimeout(timer);
      timer = setTimeout(() => loadPlayersPage().then(drawPlayers).catch(reportError), 250);
    });
    $('#ptb', root).addEventListener('click', (event) => {
      const target = event.target.closest('span[data-k]');
      if (!target) return;
      ui.players.tab = target.dataset.k;
      ui.players.page = 1;
      $$('#ptb span', root).forEach((s) => s.classList.toggle('on', s.dataset.k === ui.players.tab));
      loadPlayersPage().then(drawPlayers).catch(reportError);
    });
    $('#ppager', root).addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-page]');
      if (!btn) return;
      ui.players.page = Number(btn.dataset.page);
      loadPlayersPage().then(drawPlayers).catch(reportError);
    });
    root.querySelector('#ptab').addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-uuid]');
      if (row) openPlayer(row.dataset.uuid);
    });
    loadPlayersPage().then(drawPlayers).catch(reportError);
  },
};

function drawPlayers() {
  const table = $('#ptab');
  if (!table) return;
  const data = state.playersPage;
  if (!data) {
    table.innerHTML = `<tbody><tr><td class="m">Loading…</td></tr></tbody>`;
    return;
  }
  const cols = `<th>Status</th><th>First seen</th><th>Last seen</th><th class="mp-num">Playtime</th><th class="mp-num">Sessions</th>`;
  table.innerHTML = `<thead><tr><th>Player</th><th>UUID</th>${cols}</tr></thead><tbody>${
    data.items
      .map((p) =>
        playerRow(
          p,
          `<td>${F.dateOnly(p.firstSeenAt)}</td><td>${p.online ? 'now' : F.ago(p.lastSeenAt)}</td><td class="mp-num">${F.duration(
            p.totalPlaytimeSeconds,
          )}</td><td class="mp-num">${p.sessionCount}</td>`,
        ),
      )
      .join('') || `<tr><td class="m" colspan="7">No players found</td></tr>`
  }</tbody>`;
  const pager = $('#ppager');
  if (pager) {
    const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
    const to = Math.min(data.total, data.page * data.pageSize);
    pager.innerHTML = `<span class="m">${from}–${to} of ${data.total}</span><button class="bt" data-page="${data.page - 1}" ${
      data.page <= 1 ? 'disabled' : ''
    }>Previous</button><button class="bt" data-page="${data.page + 1}" ${data.page >= data.totalPages ? 'disabled' : ''}>Next</button>`;
  }
}

PAGES.plugins = {
  render() {
    const snapshot = state.plugins;
    const count = snapshot?.plugins?.length || 0;
    const when = snapshot?.collectedAt ? F.ago(snapshot.collectedAt) : 'never';
    return `<div class="pgw">
      <div class="ph2"><div><h2>Plugins</h2><p>${count} plugins · last inventory ${h(when)}</p></div><div class="tools">
        <input class="in" id="gsearch" placeholder="Search plugins" value="${h(ui.plugins.search)}">
      </div></div>
      <div class="kp" id="gk"></div>
      <div class="card"><table class="t" id="gtab"></table></div>
    </div>`;
  },
  mount(root) {
    const search = $('#gsearch', root);
    search.addEventListener('input', () => {
      ui.plugins.search = search.value.trim();
      drawPlugins();
    });
    drawPlugins();
  },
};

function drawPlugins() {
  const snapshot = state.plugins;
  const plugins = snapshot?.plugins || [];
  const kk = $('#gk');
  if (kk) {
    kk.innerHTML = [
      ['Plugins', plugins.length],
      ['Enabled', plugins.filter((p) => p.enabled).length],
      ['Disabled', plugins.filter((p) => !p.enabled).length],
      ['Inventory hash', snapshot ? `${snapshot.inventoryHash.slice(0, 10)}…` : '—'],
    ]
      .map(([label, value]) => kpi(label, value))
      .join('');
  }
  const table = $('#gtab');
  if (!table) return;
  const query = ui.plugins.search.toLowerCase();
  const list = plugins.filter((p) => p.pluginName.toLowerCase().includes(query));
  table.innerHTML = `<thead><tr><th>Name</th><th>Version</th><th>API</th><th>Status</th></tr></thead><tbody>${
    list
      .map(
        (p) => `<tr><td>${h(p.pluginName)}</td><td>${h(p.version)}</td><td class="m">${h(p.apiVersion || '—')}</td><td><span class="bx ${
          p.enabled ? 's' : 'x'
        }">${p.enabled ? 'Enabled' : 'Disabled'}</span></td></tr>`,
      )
      .join('') || `<tr><td class="m" colspan="4">No plugins match</td></tr>`
  }</tbody>`;
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
        <label>Address</label><div>${h(server.address || '—')}</div>
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
 * Detail modals
 * ------------------------------------------------------------------ */

async function openPlayer(uuid) {
  modal(`<h3>Loading player…</h3>`);
  try {
    const [player, sessions] = await Promise.all([
      apiGet(API.player(uuid)),
      apiGet(API.sessions(uuid, { pageSize: 10 })),
    ]);
    const p = player;
    modal(`<h3><span class="pa" style="background:${colorFor(p.uuid)}"></span>${h(p.lastKnownUsername)} <span class="bx ${
      p.online ? 's' : 'x'
    }">${p.online ? 'Online' : 'Offline'}</span></h3><div class="m">${h(p.uuid)}</div>
    <div class="mini">${[
      ['Playtime', F.duration(p.totalPlaytimeSeconds)],
      ['Sessions', p.sessionCount],
      ['First seen', F.dateOnly(p.firstSeenAt)],
      ['Last seen', p.online ? 'now' : F.ago(p.lastSeenAt)],
    ]
      .map(([label, value]) => `<div><small>${label}</small><b>${value}</b></div>`)
      .join('')}</div>
    <div><div class="m" style="margin-bottom:4px">Recent sessions</div><table class="t"><thead><tr><th>Joined</th><th>Left</th><th class="mp-num">Duration</th></tr></thead><tbody>${
      (sessions.items || [])
        .map(
          (s) => `<tr><td class="m">${F.dateTime(s.joinedAt)}</td><td class="m">${s.leftAt ? F.dateTime(s.leftAt) : 'online'}</td><td class="mp-num">${
            s.durationSeconds == null ? '—' : F.duration(s.durationSeconds)
          }</td></tr>`,
        )
        .join('') || `<tr><td class="m" colspan="3">No sessions recorded</td></tr>`
    }</tbody></table></div>
    <div class="row" style="justify-content:flex-end"><button class="bt pr" onclick="document.getElementById('md').innerHTML=''">Close</button></div>`);
  } catch (error) {
    reportError(error);
    closeModal();
  }
}

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
  $('#refreshBtn').addEventListener('click', () => refreshAll(true));

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
  const address = state.server?.address;
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
  const status = state.status || {};
  const score = healthScore();
  modal(`<h3>Server health report</h3>
    <div class="mp-code">Status: ${h(status.state || 'unknown')} (${h(status.reason || 'no reason')})
Agent: ${status.agentConnected ? 'connected' : 'disconnected'}
TPS (1m/5m/15m): ${F.tps(sample.tps1m)} / ${F.tps(sample.tps5m)} / ${F.tps(sample.tps15m)}
MSPT: ${F.mspt(sample.mspt)}
Heap: ${sample.heapUsedBytes != null ? F.gigabytes(sample.heapUsedBytes) : '—'} / ${sample.heapMaxBytes != null ? F.gigabytes(sample.heapMaxBytes) : '—'} (${F.pct(state.metrics?.heapUsedPercent)})
CPU: ${F.pct(sample.cpuUsagePercent)}
Players: ${state.metrics?.playerCount ?? '—'} / ${state.metrics?.maxPlayers ?? '—'}
Uptime: ${F.uptimeText(state.metrics?.uptimeSeconds)}
Overall health: ${score}%</div>
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
    else renderChrome();
  });
  socket.on(SOCKET.plugins, (snapshot) => {
    state.plugins = snapshot;
    if (ui.page === 'overview' || ui.page === 'plugins') scheduleRerender();
  });
  socket.on(SOCKET.event, (event) => {
    state.eventsRecent = [event, ...state.eventsRecent].slice(0, 40);
    if (ui.page === 'overview' || ui.page === 'events') scheduleRerender();
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
  $('#admName').textContent = user ? user.email.split('@')[0] : 'Admin';
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
