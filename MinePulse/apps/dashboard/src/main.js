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

/** Display metadata for the Alerts page, keyed by the real rule metric. */
const ALERT_METRIC_META = {
  tps: { name: 'TPS', label: 'TPS (1m)', unit: '', digits: 2, dir: 'lt', threshold: 18 },
  mspt: { name: 'MSPT', label: 'MSPT (ms)', unit: 'ms', digits: 1, dir: 'gt', threshold: 50 },
  heap_percent: { name: 'Heap usage', label: 'Heap used (%)', unit: '%', digits: 1, dir: 'gt', threshold: 85 },
  player_count: { name: 'Player count', label: 'Player count', unit: '', digits: 0, dir: 'lt', threshold: 1 },
  heartbeat_missing: {
    name: 'Heartbeat missing',
    label: 'Heartbeat missing (s)',
    unit: 's',
    digits: 0,
    dir: 'gt',
    threshold: 60,
  },
  agent_disconnected: {
    name: 'Agent disconnected',
    label: 'Agent disconnected (s)',
    unit: 's',
    digits: 0,
    dir: 'gt',
    threshold: 60,
  },
  repeated_incidents: {
    name: 'Repeated incidents',
    label: 'Incidents in window',
    unit: '',
    digits: 0,
    dir: 'gt',
    threshold: 3,
  },
};

const ALERT_METRIC_ORDER = [
  'tps',
  'mspt',
  'heap_percent',
  'player_count',
  'heartbeat_missing',
  'agent_disconnected',
  'repeated_incidents',
];

const ALERT_TABS = [
  ['inc', 'Incidents'],
  ['rules', 'Rules'],
  ['chan', 'Channels'],
  ['hist', 'History'],
];

const ALERT_OPERATOR_TEXT = {
  lt: 'drops below',
  lte: 'at or below',
  gt: 'goes above',
  gte: 'at or above',
  eq: 'equals',
};

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

/** The design groups severities into info / warn / error tabs. */
const EVENT_LEVEL_TONE = { info: 'i', warn: 'w', error: 'c' };
const EVENT_LEVEL_COLOR = { info: '#cfe0db', warn: '#f5c64a', error: '#ff7b7b' };
const EVENT_LEVEL_LABEL = { all: 'All', info: 'Info', warn: 'Warnings', error: 'Errors' };
const EVENT_SEVERITY_LEVEL = { info: 'info', warning: 'warn', critical: 'error' };

/** Time windows offered by the range filter; null means "everything buffered". */
const EVENT_RANGES = [
  ['15 min', 15],
  ['1 hour', 60],
  ['24 hours', 1440],
  ['All time', null],
];

/** The page tails a bounded client-side buffer (the API caps pageSize at 200). */
const EVENT_BUFFER = 200;
const EVENT_ROWS = 120;

const API = {
  server: '/api/v1/server',
  status: '/api/v1/server/status',
  metrics: '/api/v1/server/metrics/current',
  history: (range) => `/api/v1/server/metrics/history?range=${range}`,
  plugins: '/api/v1/server/plugins',
  pluginAction: (name) => `/api/v1/server/plugins/${encodeURIComponent(name)}/action`,
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
  settingsSecurity: '/api/v1/settings/security',
  settingsCredentials: '/api/v1/settings/agent-credentials',
  settingsRetention: '/api/v1/settings/retention/run',
  serverProfile: '/api/v1/server/profile',
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
  /** Newest events first; the page filters and live-tails this buffer. */
  eventsBuf: [],
  /** Session-only console output (command echo + answers). Never stored. */
  consoleLines: [],
  playersOnline: [],
  playersAll: [],
  playersRosterTotal: 0,
  playersAnalytics: null,
  activity: null,
  alerts: {
    rules: [],
    incidents: [],
    discordConfigured: false,
    ruleStatus: [],
    evaluation: null,
    broadcasts: [],
  },
  settings: null,
  security: null,
  playersPage: null,
  eventsLoaded: false,
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
  events: { q: '', re: false, src: 'All sources', range: 'All time', lv: 'all', tab: 'ev', live: true, history: [], hi: 0 },
  alerts: {
    tab: 'inc',
    filter: 'open',
    severity: 'all',
    q: '',
    draft: { metric: 'tps', dir: 'lt', threshold: '18', severity: 'warning' },
  },
  settings: {
    tab: 'gen',
    draft: null,
    dirty: false,
    saving: false,
    securityLoading: false,
    securityError: null,
  },
};

let socket = null;
let rerenderTimer = null;
/** Cached profile payload so live re-renders do not re-fetch on every tick. */
let profileData = null;

/* ------------------------------------------------------------------ *
 * Display preferences (browser-local)
 * ------------------------------------------------------------------ */

const DISPLAY_STORAGE_KEY = 'mp_display';
const DISPLAY_DEFAULTS = {
  accent: 'green',
  density: 'comfortable',
  start: 'overview',
  theme: 'dark',
  live: true,
};
const ACCENTS = {
  green: { label: 'Green', color: '#22c55e', dark: '#16a34a' },
  blue: { label: 'Blue', color: '#38bdf8', dark: '#0284c7' },
  purple: { label: 'Purple', color: '#a855f7', dark: '#7e22ce' },
  orange: { label: 'Orange', color: '#f97316', dark: '#c2410c' },
};
const START_PAGES = [
  ['overview', 'Overview'],
  ['performance', 'Performance'],
  ['players', 'Players'],
  ['plugins', 'Plugins'],
  ['events', 'Events & Logs'],
  ['alerts', 'Alerts'],
];

function loadDisplayPreferences() {
  const prefs = { ...DISPLAY_DEFAULTS };
  try {
    const raw = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored && typeof stored === 'object') {
        if (ACCENTS[stored.accent]) prefs.accent = stored.accent;
        if (stored.density === 'compact' || stored.density === 'comfortable') {
          prefs.density = stored.density;
        }
        if (START_PAGES.some(([key]) => key === stored.start)) prefs.start = stored.start;
        if (stored.theme === 'light' || stored.theme === 'dark') prefs.theme = stored.theme;
        if (typeof stored.live === 'boolean') prefs.live = stored.live;
      }
    } else {
      // Preserve a theme chosen before display preferences existed.
      const legacyTheme = localStorage.getItem('mp_theme');
      if (legacyTheme === 'light' || legacyTheme === 'dark') prefs.theme = legacyTheme;
    }
  } catch {
    /* storage disabled */
  }
  return prefs;
}

const display = loadDisplayPreferences();

function saveDisplayPreferences() {
  try {
    localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(display));
    localStorage.setItem('mp_theme', display.theme);
  } catch {
    /* storage disabled */
  }
}

function applyDisplayPreferences() {
  const accent = ACCENTS[display.accent] || ACCENTS.green;
  document.documentElement.style.setProperty('--g', accent.color);
  document.documentElement.style.setProperty('--g2', accent.dark);
  document.documentElement.dataset.theme = display.theme;
  document.body.classList.toggle('mp-compact', display.density === 'compact');
}

function setThemePreference(theme) {
  display.theme = theme === 'light' ? 'light' : 'dark';
  applyDisplayPreferences();
  saveDisplayPreferences();
}

function resetDisplayPreferences() {
  Object.assign(display, DISPLAY_DEFAULTS);
  applyDisplayPreferences();
  saveDisplayPreferences();
}

function openStartPage() {
  if (!display.start || display.start === 'overview') return;
  if (!PAGES[display.start]) return;
  go(display.start);
}

/* ------------------------------------------------------------------ *
 * Settings metadata
 * ------------------------------------------------------------------ */

const SETTINGS_SECTIONS = [
  ['gen', 'General', 'Server identity'],
  ['mon', 'Monitoring', 'Collection and thresholds'],
  ['not', 'Notifications', 'Where alerts go'],
  ['disp', 'Display', 'Look and feel'],
  ['sec', 'Security', 'Access and API keys'],
  ['data', 'Data', 'Export, import and reset'],
];

const SETTINGS_NUMERIC_FIELDS = [
  {
    key: 'retentionRawMetricsDays',
    id: 'st-raw',
    label: 'Raw metric samples',
    hint: 'High-resolution telemetry behind the 15m and 1h charts.',
    min: 1,
    max: 3650,
    unit: 'days',
  },
  {
    key: 'retentionAggregated1mDays',
    id: 'st-1m',
    label: '1-minute rollups',
    hint: 'Feeds the 6h and 24h charts.',
    min: 1,
    max: 3650,
    unit: 'days',
  },
  {
    key: 'retentionAggregated1hDays',
    id: 'st-1h',
    label: '1-hour rollups',
    hint: 'Feeds long-range charts and trend comparisons.',
    min: 1,
    max: 3650,
    unit: 'days',
  },
  {
    key: 'retentionEventsDays',
    id: 'st-ev',
    label: 'Server events',
    hint: 'Console events, alerts and setting changes.',
    min: 1,
    max: 3650,
    unit: 'days',
  },
  {
    key: 'retentionPlayerSessionsDays',
    id: 'st-sess',
    label: 'Player sessions',
    hint: 'Join and leave history, playtime and analytics.',
    min: 1,
    max: 3650,
    unit: 'days',
  },
  {
    key: 'heartbeatStaleSeconds',
    id: 'st-stale',
    label: 'Stale after',
    hint: 'How long without a heartbeat before the agent is marked stale.',
    min: 5,
    max: 3600,
    unit: 'seconds',
  },
  {
    key: 'heartbeatOfflineSeconds',
    id: 'st-off',
    label: 'Offline after',
    hint: 'How long without a heartbeat before the server is marked offline.',
    min: 5,
    max: 86400,
    unit: 'seconds',
  },
];

const SETTINGS_FALLBACK_DEFAULTS = {
  retentionRawMetricsDays: 7,
  retentionAggregated1mDays: 30,
  retentionAggregated1hDays: 180,
  retentionEventsDays: 30,
  retentionPlayerSessionsDays: 90,
  heartbeatStaleSeconds: 30,
  heartbeatOfflineSeconds: 60,
};

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
  await loadBroadcasts();
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

/** Minutes in the selected range filter, or null for "All time". */
const eventRangeMinutes = () =>
  EVENT_RANGES.find(([label]) => label === ui.events.range)?.[1] ?? null;

/** Fetch the live buffer: the newest events inside the selected time window. */
async function loadEventsPage() {
  const minutes = eventRangeMinutes();
  const page = await apiGet(
    API.events({
      page: 1,
      pageSize: EVENT_BUFFER,
      from: minutes ? new Date(Date.now() - minutes * 60000).toISOString() : undefined,
    }),
  );
  state.eventsBuf = page?.items || [];
  state.eventsLoaded = true;
  return state.eventsBuf;
}

async function loadAlerts() {
  const broadcasts = state.alerts.broadcasts || [];
  state.alerts = await apiGet(API.alerts);
  state.alerts.broadcasts = broadcasts;
}

/** Recent real broadcasts for the Alerts sidebar (no fabricated chat history). */
async function loadBroadcasts() {
  try {
    const data = await apiGet(API.actions({ limit: 20 }));
    state.alerts.broadcasts = (data?.items || [])
      .filter((item) => item.action === 'broadcast')
      .slice(0, 5);
  } catch {
    state.alerts.broadcasts = state.alerts.broadcasts || [];
  }
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
  const open = (state.alerts.incidents || []).filter((i) => i.status !== 'resolved').slice(0, 4);
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

/** Target state: a staged change wins over the state that is live right now. */
const pluginTarget = (p) =>
  p.staged === 'disable' ? false : p.staged === 'enable' ? true : p.enabled;

/** Real enable/disable switch for admins; a locked read-out for everyone else. */
function pluginToggle(p) {
  const target = pluginTarget(p);
  const on = target ? 'on' : '';
  if (!isAdmin()) {
    return `<span class="sw ${on} ro" title="Admin access required to change plugin state"></span>`;
  }
  const action = target ? 'disable' : 'enable';
  return `<span class="sw ${on}${p.staged ? ' pend' : ''}" role="button" tabindex="0" data-plugin-toggle="${h(
    p.pluginName,
  )}" data-enable="${action === 'enable' ? '1' : '0'}" title="${
    action === 'disable' ? 'Disable' : 'Enable'
  } ${h(p.pluginName)} — applies on the next server restart"></span>`;
}

/**
 * Trailing cell: plugin jars are moved on disk and Paper applies the change on
 * the next start, so a staged change shows a restart hint instead of a button.
 */
function pluginPendingCell(p) {
  if (!p.staged) return '';
  const label = p.staged === 'disable' ? 'Off after restart' : 'On after restart';
  return `<span class="bx w" title="The jar is moved when the server stops; the next start applies it">${label}</span>`;
}

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
        <button class="bt pr" disabled title="Bulk enable is not offered — use the switch on each plugin.">Enable all</button>
      </div></div>
      <div class="kp6" id="gk"></div>
      <div class="card">
        <div class="m" style="padding:0 0 8px">Enable and disable stage a change: the jar moves between <code>plugins/</code> and <code>plugins-disabled/</code> and Paper applies it on the next server start. A plugin that is loaded right now keeps its jar open, so its jar is moved out when the server stops. Reload is not offered — Paper closes a plugin's class loader when it is disabled, which breaks other plugins.${
          isAdmin() ? '' : ' Admin access is required to change plugin state.'
        }</div>
        <table class="t" id="gtab"></table>
      </div>
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
      if (cell) {
        showPluginDetail(cell.dataset.plugin);
        return;
      }
      const toggle = event.target.closest('[data-plugin-toggle]');
      if (toggle) {
        runPluginAction(
          toggle.dataset.pluginToggle,
          toggle.dataset.enable === '1' ? 'enable' : 'disable',
        );
      }
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
  const enabled = plugins.filter((p) => pluginTarget(p));

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
  if (filter === 'enabled') list = list.filter((p) => pluginTarget(p));
  else if (filter === 'disabled') list = list.filter((p) => !pluginTarget(p));
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
            <td>${pluginToggle(p)}</td>
            <td style="text-align:right">${pluginPendingCell(p)}</td>
          </tr>`,
          )
          .join('') || '<tr><td class="m" colspan="9">No plugins match</td></tr>';

  table.innerHTML = headers + `<tbody>${body}</tbody>`;
}

function showPluginDetail(name) {
  const plugin = (state.plugins?.plugins || []).find((p) => p.pluginName === name);
  if (!plugin) return;
  const target = pluginTarget(plugin);
  const pct = plugin.enabled ? pluginTickCostMap().get(plugin.pluginName.toLowerCase()) : null;
  const pending = plugin.staged
    ? `${plugin.staged === 'disable' ? 'Disables' : 'Enables'} on the next server start`
    : null;
  modal(`<div data-plugin-modal="${h(plugin.pluginName)}">
  <h3>${h(plugin.pluginName)} <span class="bx ${plugin.enabled ? 's' : 'x'}">${
    plugin.enabled ? 'Enabled' : 'Disabled'
  }</span>${pending ? ' <span class="bx w">Next start</span>' : ''}</h3>
  <div class="m">${plugin.author ? `by ${h(plugin.author)}` : 'author not reported'}</div>
  ${rows([
    ['Version', h(plugin.version)],
    ['API version', plugin.apiVersion ? h(plugin.apiVersion) : '—'],
    ['Tick cost', pct == null ? notCollected('No profiler samples for this plugin yet') : `${F.fixed(pct, 2)}%`],
    ['Memory', notCollected('Per-plugin memory is not measured')],
    ['Commands', plugin.commandCount == null ? notCollected('Command count not reported') : F.num(plugin.commandCount)],
    ['Status', plugin.enabled ? 'Enabled' : 'Disabled'],
    ['Next start', pending || 'No change staged'],
  ])}
  <div class="m" style="padding-top:6px">Enable and disable move the jar between <code>plugins/</code> and <code>plugins-disabled/</code>; the change is applied when the server starts. A loaded plugin holds its jar open, so its jar moves out when the server stops. Reload is not offered because Paper closes a plugin's class loader on disable, which breaks other plugins.${
    isAdmin() ? '' : ' Admin access is required.'
  }</div>
  <div class="row" style="gap:8px;justify-content:flex-end">
    ${
      target
        ? `<button class="bt dn" data-modal-plugin-action="disable"${disAttr(!isAdmin())}>Disable</button>`
        : `<button class="bt pr" data-modal-plugin-action="enable"${disAttr(!isAdmin())}>Enable</button>`
    }
    <button class="bt pr" data-close-modal>Close</button>
  </div></div>`);
  const close = $('#md [data-close-modal]');
  if (close) close.addEventListener('click', closeModal);
  $$('#md [data-modal-plugin-action]').forEach((button) =>
    button.addEventListener('click', () =>
      runPluginAction(plugin.pluginName, button.dataset.modalPluginAction),
    ),
  );
}

/** Human labels for the plugin lifecycle verbs. */
const PLUGIN_ACTION_LABELS = { enable: 'Enable', disable: 'Disable' };

async function loadPlugins() {
  state.plugins = await apiGet(API.plugins);
  return state.plugins;
}

let pluginRefreshTimer = null;

/** Re-read the inventory shortly after a plugin action so the table catches up. */
function schedulePluginRefresh() {
  clearTimeout(pluginRefreshTimer);
  pluginRefreshTimer = setTimeout(() => {
    loadPlugins()
      .then(() => {
        if (ui.page === 'plugins') drawPlugins();
        refreshOpenPluginModal();
      })
      .catch(() => {});
  }, 1600);
}

/** Re-render the plugin detail modal if it is currently open. */
function refreshOpenPluginModal() {
  const host = $('#md [data-plugin-modal]');
  if (host) showPluginDetail(host.dataset.pluginModal);
}

/** Record a staged change optimistically; the next inventory confirms it. */
function applyPluginStaged(name, action) {
  const plugin = (state.plugins?.plugins || []).find((p) => p.pluginName === name);
  if (!plugin) return;
  const matchesLive = (action === 'enable') === plugin.enabled;
  plugin.staged = matchesLive ? null : action;
  if (ui.page === 'plugins') drawPlugins();
  refreshOpenPluginModal();
}

/** Queue a plugin change; the agent moves the jar and Paper applies it on restart. */
async function runPluginAction(name, action) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  try {
    await apiSend('POST', API.pluginAction(name), { action });
    applyPluginStaged(name, action);
    toast(
      `${PLUGIN_ACTION_LABELS[action] || action} ${name} — applies on the next server restart`,
    );
    schedulePluginRefresh();
  } catch (error) {
    reportError(error);
  }
}

PAGES.events = {
  render() {
    // Buffered types first, then the known taxonomy so the list stays stable
    // after Clear or before the first load.
    const sources = [...new Set([...state.eventsBuf.map((e) => e.eventType), ...EVENT_CATEGORIES])];
    return `<div class="pgw">
      <div class="ph2"><div><h2>Events &amp; Logs</h2><p>Search, filter and live-tail server output — latest ${
        EVENT_BUFFER
      } events</p></div><div class="tools">
        <input class="in" id="es" placeholder="Search messages" value="${h(ui.events.q)}">
        <label class="m"><input type="checkbox" id="ere"${ui.events.re ? ' checked' : ''}> Regex</label>
        <select class="in" id="esrc"><option>All sources</option>${sources
          .map((s) => `<option${s === ui.events.src ? ' selected' : ''}>${h(s)}</option>`)
          .join('')}</select>
        <select class="in" id="erng">${EVENT_RANGES.map(
          ([label]) => `<option${label === ui.events.range ? ' selected' : ''}>${label}</option>`,
        ).join('')}</select>
        <button class="bt" id="elive">${ui.events.live ? 'Pause tail' : 'Resume tail'}</button>
        <button class="bt dn" id="eclear" title="Clear the local view only — stored events are never deleted">Clear</button>
      </div></div>
      <div class="row">
        <div class="tabs" id="elv">${['all', 'info', 'warn', 'error']
          .map((k) => `<span data-k="${k}" class="${k === ui.events.lv ? 'on' : ''}">${EVENT_LEVEL_LABEL[k]}</span>`)
          .join('')}</div>
        <span style="flex:1"></span>
        <div class="tabs" id="etb">${[['ev', 'Events'], ['log', 'Console']]
          .map(([k, label]) => `<span data-k="${k}" class="${k === ui.events.tab ? 'on' : ''}">${label}</span>`)
          .join('')}</div>
      </div>
      <div class="card" id="eb"></div>
    </div>`;
  },
  mount(root) {
    let timer = null;
    const search = $('#es', root);
    search.addEventListener('input', () => {
      ui.events.q = search.value;
      clearTimeout(timer);
      timer = setTimeout(drawEvents, 150);
    });
    $('#ere', root).addEventListener('change', (event) => {
      ui.events.re = event.target.checked;
      drawEvents();
    });
    $('#esrc', root).addEventListener('change', (event) => {
      ui.events.src = event.target.value;
      drawEvents();
    });
    $('#erng', root).addEventListener('change', (event) => {
      ui.events.range = event.target.value;
      loadEventsPage().then(drawEvents).catch(reportError);
    });
    $('#elive', root).addEventListener('click', (event) => {
      ui.events.live = !ui.events.live;
      event.target.textContent = ui.events.live ? 'Pause tail' : 'Resume tail';
      drawEvents();
    });
    $('#eclear', root).addEventListener('click', () => {
      state.eventsBuf = [];
      state.consoleLines = [];
      toast('Local view cleared — stored events are kept');
      drawEvents();
    });
    $('#elv', root).addEventListener('click', (event) => {
      const tab = event.target.closest('[data-k]');
      if (!tab) return;
      ui.events.lv = tab.dataset.k;
      $$('#elv span').forEach((span) => span.classList.toggle('on', span.dataset.k === ui.events.lv));
      drawEvents();
    });
    $('#etb', root).addEventListener('click', (event) => {
      const tab = event.target.closest('[data-k]');
      if (!tab) return;
      ui.events.tab = tab.dataset.k;
      $$('#etb span').forEach((span) => span.classList.toggle('on', span.dataset.k === ui.events.tab));
      drawEvents();
    });
    $('#eb', root).addEventListener('click', (event) => {
      const button = event.target.closest('[data-cmd]');
      if (button) {
        runConsoleCommand(button.dataset.cmd);
        return;
      }
      if (ui.events.tab !== 'ev') return;
      const row = event.target.closest('tr[data-id]');
      if (!row) return;
      const evt = state.eventsBuf.find((e) => e.id === row.dataset.id);
      if (evt) openEvent(evt);
    });
    if (state.eventsLoaded) drawEvents();
    else loadEventsPage().then(() => rerender()).catch(reportError);
  },
};

/** Map an event onto one of the design's info / warn / error levels. */
const eventLevel = (e) => EVENT_SEVERITY_LEVEL[e.severity] || 'info';

/** Escape search output and wrap matches in <mark>, like the design. */
function highlight(text, rx) {
  const escaped = h(text);
  if (!rx) return escaped;
  try {
    return escaped.replace(new RegExp(rx.source, `${rx.flags}g`), (match) => `<mark>${match}</mark>`);
  } catch {
    return escaped;
  }
}

/** The buffered events inside the range + source + search filters (level untouched). */
function eventsWindow() {
  const minutes = eventRangeMinutes();
  const cutoff = minutes ? Date.now() - minutes * 60000 : 0;
  const needle = ui.events.q.trim();
  let rx = null;
  if (needle) {
    try {
      rx = new RegExp(ui.events.re ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
      rx = null; // Invalid regex: treat as no match rather than crashing the page.
    }
  }
  const win = state.eventsBuf.filter((e) => {
    if (cutoff && Date.parse(e.occurredAt) <= cutoff) return false;
    if (ui.events.src !== 'All sources' && e.eventType !== ui.events.src) return false;
    if (rx && !rx.test(e.summary)) return false;
    return true;
  });
  return { win, rx };
}

function drawEvents() {
  const host = $('#eb');
  if (!host) return;
  const { win, rx } = eventsWindow();
  const count = (level) =>
    level === 'all' ? win.length : win.filter((e) => eventLevel(e) === level).length;
  $$('#elv span').forEach((span) => {
    span.textContent = `${EVENT_LEVEL_LABEL[span.dataset.k]} (${count(span.dataset.k)})`;
  });
  const list = win.filter((e) => ui.events.lv === 'all' || eventLevel(e) === ui.events.lv);

  if (ui.events.tab === 'ev') {
    host.innerHTML = `<table class="t"><thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th></tr></thead><tbody>${
      list
        .slice(0, EVENT_ROWS)
        .map(
          (e) =>
            `<tr class="mp-click" data-id="${h(e.id)}"><td class="m" title="${h(
              F.dateTime(e.occurredAt),
            )}">${F.timeSeconds(e.occurredAt)}</td><td><span class="bx ${EVENT_LEVEL_TONE[eventLevel(
              e,
            )]}">${eventLevel(e)}</span></td><td class="m">${h(e.eventType.replace(/_/g, ' '))}</td><td>${highlight(
              e.summary,
              rx,
            )}</td></tr>`,
        )
        .join('') || `<tr><td class="m" colspan="4">No events match</td></tr>`
    }</tbody>`;
    return;
  }
  drawConsole(list, rx);
}

/* ------------------------------------------------------------------ *
 * Console view: a tail of the structured event stream plus a fixed,
 * typed command set. Like the moderation verbs, the console never runs
 * an arbitrary server command.
 * ------------------------------------------------------------------ */

const CONSOLE_COMMANDS = ['help', 'list', 'tps', 'gc', 'plugins', 'version'];

/** Append a line to the session-only console buffer (never stored). */
function consoleLine(msg, level = 'info') {
  state.consoleLines.push({ t: new Date(), lvl: level, msg });
  if (state.consoleLines.length > 200) state.consoleLines.shift();
}

function drawConsole(list, rx) {
  const host = $('#eb');
  if (!host) return;
  if (!host.querySelector('#cs')) {
    host.innerHTML = `<div class="console" id="cs"></div>
      <div class="row" style="margin-bottom:8px;align-items:center">${CONSOLE_COMMANDS.map(
        (c) => `<button class="bt" data-cmd="${c}">${c}</button>`,
      ).join('')}<span class="m" style="margin-left:8px">Read-only answers from live data. Raw server commands are not exposed, and console line capture is not collected — this tails the structured event stream.</span></div>
      <input class="in" id="cmd" style="width:100%" placeholder="Type a command. Arrow keys recall history.">`;
    host.querySelector('#cmd').addEventListener('keydown', onConsoleKey);
  }
  const target = host.querySelector('#cs');
  const lines = [
    ...list
      .slice(0, 90)
      .reverse()
      .map((e) => ({ t: e.occurredAt, lvl: eventLevel(e), msg: e.summary })),
    ...state.consoleLines,
  ];
  target.innerHTML =
    lines
      .map(
        (line) =>
          `<div><span class="m">[${F.timeSeconds(line.t)} ${String(line.lvl).toUpperCase()}]</span> <span style="color:${
            EVENT_LEVEL_COLOR[line.lvl] || EVENT_LEVEL_COLOR.info
          }">${highlight(line.msg, rx)}</span></div>`,
      )
      .join('') || '<div class="m">No events in this view yet.</div>';
  target.scrollTop = target.scrollHeight;
}

function onConsoleKey(event) {
  const input = event.target;
  if (event.key === 'Enter') {
    const value = input.value.trim();
    if (!value) return;
    ui.events.history.push(value);
    ui.events.hi = ui.events.history.length;
    input.value = '';
    runConsoleCommand(value);
  } else if (event.key === 'ArrowUp' && ui.events.hi > 0) {
    input.value = ui.events.history[--ui.events.hi];
  } else if (event.key === 'ArrowDown') {
    input.value = ui.events.history[++ui.events.hi] || '';
  }
}

/** Run one whitelisted command; every answer is real dashboard data. */
async function runConsoleCommand(raw) {
  const parts = raw.trim().split(/\s+/);
  const verb = String(parts[0] || '').toLowerCase();
  consoleLine(`> ${raw.trim()}`);
  const sample = state.metrics?.sample || {};
  const fmt = (v) => (v == null ? '—' : Number(v).toFixed(2));

  switch (verb) {
    case 'help':
      consoleLine(
        `Commands: ${CONSOLE_COMMANDS.join(', ')}, say <message> — read-only summaries of live data`,
      );
      break;
    case 'list': {
      const online = state.playersOnline || [];
      consoleLine(
        `There are ${online.length} of ${state.metrics?.maxPlayers ?? '?'} players online: ${
          online.map((p) => p.name).join(', ') || 'nobody'
        }`,
      );
      break;
    }
    case 'tps':
      consoleLine(
        `TPS from last 1m, 5m, 15m: ${fmt(sample.tps1m)}, ${fmt(sample.tps5m)}, ${fmt(
          sample.tps15m,
        )} (instant 5s TPS is not measured)`,
      );
      break;
    case 'gc': {
      const collectors = Array.isArray(sample.gc) ? sample.gc : [];
      const heap =
        sample.heapUsedBytes == null || sample.heapMaxBytes == null
          ? null
          : `Heap: ${F.gigabytes(sample.heapUsedBytes)} / ${F.gigabytes(sample.heapMaxBytes)} GB (${
              state.metrics.heapUsedPercent == null ? '—' : F.fixed(state.metrics.heapUsedPercent, 1)
            }%)`;
      if (!collectors.length) {
        consoleLine('Garbage collection counters are not reported by the agent', 'warn');
        break;
      }
      consoleLine(
        collectors
          .map((c) => `${c.name}: ${F.num(c.count)} collections, ${F.fixed(c.totalMs, 0)} ms total`)
          .join('   '),
      );
      if (heap) consoleLine(heap);
      break;
    }
    case 'plugins': {
      const enabled = (state.plugins?.plugins || []).filter((p) => p.enabled);
      consoleLine(`Plugins (${enabled.length}): ${enabled.map((p) => p.pluginName).join(', ') || 'none'}`);
      break;
    }
    case 'version':
      consoleLine(
        `${state.status?.software || state.server?.software || 'Unknown software'} ${
          state.status?.minecraftVersion || state.server?.minecraftVersion || ''
        }`.trim(),
      );
      break;
    case 'say': {
      const text = parts.slice(1).join(' ').trim();
      if (!text) {
        consoleLine('Usage: say <message>', 'warn');
        break;
      }
      if (!isAdmin()) {
        consoleLine('Admin access is required to broadcast', 'error');
        break;
      }
      try {
        await apiSend('POST', API.broadcast, { message: text });
        consoleLine(`[Server] ${text}`);
        toast('Broadcast queued');
      } catch (error) {
        consoleLine(`Broadcast failed: ${error.message || 'request error'}`, 'error');
      }
      break;
    }
    default:
      consoleLine('Unknown command. Type "help" for a list.', 'error');
  }
  if (ui.events.tab === 'log') drawEvents();
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

const alertMeta = (metric) =>
  ALERT_METRIC_META[metric] || {
    name: metric,
    label: metric,
    unit: '',
    digits: 1,
    dir: 'gt',
    threshold: 0,
  };

const alertRuleFor = (ruleId) => (state.alerts.rules || []).find((r) => r.id === ruleId);

const alertRuleMuted = (rule) =>
  Boolean(rule?.mutedUntil && new Date(rule.mutedUntil).getTime() > Date.now());

function alertValueText(metric, value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const meta = alertMeta(metric);
  const shown = Number(value).toFixed(meta.digits);
  return meta.unit ? `${shown} ${meta.unit}` : shown;
}

PAGES.alerts = {
  render() {
    return `<div class="pgw">
      <div class="ph2"><div><h2>Alerts</h2><p>Incidents, rules and notification channels</p></div>
        <div class="tabs" id="atb">${ALERT_TABS.map(
          ([key, label]) =>
            `<span data-alert-tab="${key}" class="${ui.alerts.tab === key ? 'on' : ''}">${label}</span>`,
        ).join('')}</div>
      </div>
      <div class="kp6" id="ak"></div>
      <div class="g12"><div class="s8" id="ab"></div><div class="s4" id="ar"></div></div>
    </div>`;
  },
  mount(root) {
    const tabs = $('#atb', root);
    if (tabs) {
      tabs.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-alert-tab]');
        if (!tab) return;
        ui.alerts.tab = tab.dataset.alertTab;
        $$('#atb span', root).forEach((el) =>
          el.classList.toggle('on', el.dataset.alertTab === ui.alerts.tab),
        );
        drawAlerts();
      });
    }
    const body = $('#ab', root);
    if (body) {
      body.addEventListener('click', onAlertClick);
      body.addEventListener('change', onAlertChange);
      body.addEventListener('input', onAlertInput);
      body.addEventListener('keydown', onAlertKeydown);
    }
    const side = $('#ar', root);
    if (side) side.addEventListener('keydown', onAlertSideKeydown);
    drawAlerts();
  },
};

function drawAlerts() {
  if (!$('#ab')) return;
  drawAlertKpis();
  drawAlertSidebar();
  drawAlertBody();
}

function drawAlertKpis() {
  const host = $('#ak');
  if (!host) return;
  const incidents = state.alerts.incidents || [];
  const rules = state.alerts.rules || [];
  const count = (status) => incidents.filter((i) => i.status === status).length;
  const resolved = incidents.filter((i) => i.resolvedAt);
  const avgSeconds = resolved.length
    ? resolved.reduce(
        (sum, i) => sum + Math.max(0, new Date(i.resolvedAt).getTime() - new Date(i.startedAt).getTime()),
        0,
      ) /
      resolved.length /
      1000
    : null;
  host.innerHTML = [
    `<div class="card kc r" title="From the most recent incidents returned by the API"><small>Active</small><b>${count('open')}</b></div>`,
    `<div class="card kc y" title="From the most recent incidents returned by the API"><small>Acknowledged</small><b>${count('acknowledged')}</b></div>`,
    `<div class="card kc" title="From the most recent incidents returned by the API"><small>Resolved</small><b>${count('resolved')}</b></div>`,
    `<div class="card kc b"><small>Rules on</small><b>${rules.filter((r) => r.enabled).length} / ${rules.length}</b></div>`,
    `<div class="card kc y"><small>Muted rules</small><b>${rules.filter(alertRuleMuted).length}</b></div>`,
    `<div class="card kc b" title="Average over the most recent incidents returned by the API"><small>Avg time to resolve</small><b>${F.duration(
      avgSeconds,
    )}</b></div>`,
  ].join('');
}

function drawAlertSidebar() {
  const host = $('#ar');
  if (!host) return;
  // The metrics socket redraws this panel every 10s; keep an in-progress
  // broadcast message (and its caret) instead of wiping it mid-sentence.
  const previousInput = $('#abc');
  const draft = previousInput ? previousInput.value : '';
  const hadFocus = Boolean(previousInput && document.activeElement === previousInput);
  const caret = previousInput ? previousInput.selectionStart : null;
  const incidents = state.alerts.incidents || [];
  const rules = state.alerts.rules || [];
  const open = incidents.filter((i) => i.status !== 'resolved');
  const online = state.playersOnline.length;
  const broadcasts = state.alerts.broadcasts || [];
  const sev = [
    ['Critical', open.filter((i) => i.ruleSeverity === 'critical').length, '#ef4444'],
    ['Warning', open.filter((i) => i.ruleSeverity === 'warning').length, '#f5b82e'],
    ['Info', open.filter((i) => i.ruleSeverity === 'info').length, '#38bdf8'],
  ];
  const statusById = new Map((state.alerts.ruleStatus || []).map((s) => [s.ruleId, s]));
  const ruleRows = rules
    .map((rule) => {
      const status = statusById.get(rule.id);
      const muted = alertRuleMuted(rule);
      const dot = !rule.enabled ? '#456' : muted ? '#9ab' : !status || status.value == null ? '#456' : status.breaching ? '#ef4444' : '#22c55e';
      const value =
        !rule.enabled
          ? 'off'
          : muted
            ? 'muted'
            : !status || status.value == null
              ? 'no data'
              : `${alertValueText(rule.metric, status.value)} / ${alertValueText(rule.metric, rule.threshold)}`;
      return `<div class="hbr" style="grid-template-columns:10px 1fr auto" title="${h(
        rule.name,
      )}: ${h(value)}"><i style="width:8px;height:8px;border-radius:50%;background:${dot}"></i><span>${h(
        rule.name,
      )}</span><b class="m">${h(value)}</b></div>`;
    })
    .join('');
  host.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="ct">Message all players <small>${online} online</small></div>
      <input class="in" id="abc" style="width:100%" placeholder="Type a message and press Enter" autocomplete="off"${disAttr(
        !isAdmin(),
      )}>
      <div class="m" style="margin-top:8px">${
        isAdmin()
          ? 'Queued to the agent and delivered to every online player.'
          : 'Admin access is required to broadcast.'
      }</div>
      <div class="chl" style="margin-top:8px">${
        broadcasts
          .map(
            (item) =>
              `<div class="tr"><span class="m" style="width:44px">${F.clock(
                item.createdAt,
              )}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(
                item.detail,
              )}${item.status === 'failed' ? ' <span class="bx c">failed</span>' : ''}</span></div>`,
          )
          .join('') || '<div class="m" style="font-size:10px;padding:4px 0">No broadcasts sent yet.</div>'
      }</div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="ct">Open incidents</div>
      <div class="cc">${
        open.length
          ? donut(sev, String(open.length), 'open')
          : donut([['ok', 1, '#22c55e']], '0', 'all clear')
      }${legend(sev, (v) => v)}</div>
    </div>
    <div class="card">
      <div class="ct">Rule status <small>live</small></div>
      ${ruleRows || '<div class="m" style="padding:6px 0">No rules configured</div>'}
    </div>`;
  const input = $('#abc');
  if (input) {
    if (draft) input.value = draft;
    if (hadFocus) {
      input.focus();
      if (caret != null) {
        try {
          input.setSelectionRange(caret, caret);
        } catch {
          /* selection unsupported */
        }
      }
    }
  }
}

function drawAlertBody() {
  const host = $('#ab');
  if (!host) return;
  if (ui.alerts.tab === 'rules') drawAlertRules(host);
  else if (ui.alerts.tab === 'chan') drawAlertChannels(host);
  else if (ui.alerts.tab === 'hist') drawAlertHistory(host);
  else drawAlertIncidents(host);
}

function drawAlertIncidents(host) {
  const incidents = state.alerts.incidents || [];
  const filter = ui.alerts.filter;
  const severity = ui.alerts.severity;
  const q = ui.alerts.q.trim().toLowerCase();
  const list = incidents.filter((i) => {
    if (filter === 'open' && i.status === 'resolved') return false;
    if (filter === 'resolved' && i.status !== 'resolved') return false;
    if (severity !== 'all' && i.ruleSeverity !== severity) return false;
    if (q && !`${i.ruleName} ${i.summary || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const ev = state.alerts.evaluation || {};
  host.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      ${selectHTML('af-status', [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']], filter)}
      ${selectHTML(
        'af-sev',
        [['all', 'All'], ['critical', 'critical'], ['warning', 'warning'], ['info', 'info']],
        severity,
      )}
      <input class="in" id="aq" placeholder="Search incidents" value="${h(ui.alerts.q)}" autocomplete="off">
      <span style="flex:1"></span>
      <button class="bt" data-alert-bulk="ack"${disAttr(!isAdmin())}>Acknowledge all</button>
      <button class="bt pr" data-alert-bulk="resolve"${disAttr(!isAdmin())}>Resolve all</button>
    </div>
    ${list.map(alertIncidentCard).join('') || `<div class="card m" style="text-align:center;padding:30px">${
      incidents.length
        ? 'No incidents in this view.'
        : `No incidents recorded yet. Rules are evaluated every ${ev.intervalSeconds ?? 10}s and open an incident after ${
            ev.triggerEvaluations ?? 2
          } breaching checks.`
    }</div>`}`;
}

function alertIncidentCard(incident) {
  const rule = alertRuleFor(incident.alertRuleId);
  const resolved = incident.status === 'resolved';
  const acked = incident.status === 'acknowledged';
  const muted = alertRuleMuted(rule);
  const tone = F.SEVERITY_TONE[incident.ruleSeverity] || 'w';
  const started = new Date(incident.startedAt).getTime();
  const ended = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Date.now();
  const lasted = F.duration(Math.max(0, ended - started) / 1000);
  return `<div class="inc ${incident.ruleSeverity || 'warning'}${resolved ? ' done' : ''}">
    <div class="ii">${incident.ruleSeverity === 'info' ? 'i' : '!'}</div>
    <div class="ib">
      <b>${h(incident.ruleName)}</b>
      <span class="bx ${tone}">${h(incident.ruleSeverity)}</span>
      ${acked ? '<span class="bx x">acknowledged</span>' : ''}
      ${resolved ? '<span class="bx s">resolved</span>' : ''}
      ${muted && !resolved ? '<span class="bx x">rule muted</span>' : ''}
      <p>${h(incident.summary || 'No summary recorded')}</p>
      <small>Opened ${F.ago(incident.startedAt)}${
        resolved ? ` · lasted ${lasted} · resolved ${F.ago(incident.resolvedAt)}` : ` · open for ${lasted}`
      }${incident.triggerValue != null ? ` · value ${alertValueText(incident.ruleMetric, incident.triggerValue)}` : ''}</small>
    </div>
    <div class="ia">
      ${
        resolved
          ? ''
          : `${acked ? '' : `<button class="bt sm" data-alert-incident-action="ack" data-alert-incident="${h(incident.id)}"${disAttr(!isAdmin())}>Acknowledge</button>`}
        <button class="bt sm" data-alert-incident-action="snooze" data-alert-incident="${h(incident.id)}"${disAttr(!isAdmin())}>Snooze 30m</button>
        <button class="bt sm pr" data-alert-incident-action="resolve" data-alert-incident="${h(incident.id)}"${disAttr(!isAdmin())}>Resolve</button>`
      }
      <button class="bt sm dn" data-alert-incident-action="delete" data-alert-incident="${h(incident.id)}"${disAttr(!isAdmin())}>Delete</button>
    </div>
  </div>`;
}

function drawAlertRules(host) {
  const rules = state.alerts.rules || [];
  const ev = state.alerts.evaluation || {};
  const cadence = ev.intervalSeconds ?? 10;
  const d = ui.alerts.draft;
  host.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="ct">New rule</div>
      <div class="row">
        <select class="in" id="nr-metric">${ALERT_METRIC_ORDER.map(
          (key) =>
            `<option value="${key}"${key === d.metric ? ' selected' : ''}>${alertMeta(key).label}</option>`,
        ).join('')}</select>
        <select class="in" id="nr-dir">
          <option value="gt"${d.dir === 'gt' ? ' selected' : ''}>goes above</option>
          <option value="lt"${d.dir === 'lt' ? ' selected' : ''}>drops below</option>
        </select>
        <input class="in" id="nr-threshold" type="number" step="any" value="${h(d.threshold)}" style="width:90px">
        <select class="in" id="nr-severity">${['warning', 'critical', 'info']
          .map((s) => `<option value="${s}"${s === d.severity ? ' selected' : ''}>${s}</option>`)
          .join('')}</select>
        <button class="bt pr" id="nr-add"${disAttr(!isAdmin())}>Add rule</button>
        <button class="bt" id="nr-advanced"${disAttr(!isAdmin())}>More options</button>
      </div>
      <div class="m" style="margin-top:8px">Checked every ${cadence}s; opens after ${
        ev.triggerEvaluations ?? 2
      } consecutive breaching checks.${
        isAdmin() ? '' : ' Admin access is required to add or change rules.'
      }</div>
    </div>
    <div class="g12">${
      rules.map(alertRuleCard).join('') ||
      `<div class="card m s12" style="text-align:center;padding:30px">No rules yet — add one above. MinePulse does not seed example rules.</div>`
    }</div>`;
}

function alertRuleCard(rule) {
  const meta = alertMeta(rule.metric);
  const tone = F.SEVERITY_TONE[rule.severity] || 'w';
  const muted = alertRuleMuted(rule);
  const ev = state.alerts.evaluation || {};
  const windowText =
    rule.metric === 'repeated_incidents'
      ? `over <input class="in" type="number" min="10" max="3600" value="${rule.evaluationWindowSeconds}" data-alert-rule-window="${h(
          rule.id,
        )}" style="width:58px;padding:3px 6px"${disAttr(!isAdmin())}>s`
      : `for ${ev.triggerEvaluations ?? 2} checks`;
  return `<div class="rl s6">
    <div class="row">
      <b class="lk mp-click" data-alert-rule-edit="${h(rule.id)}" title="Last triggered ${
        rule.lastTriggeredAt ? F.ago(rule.lastTriggeredAt) : 'never'
      }. Click to edit.">${h(rule.name)}</b>
      <span class="bx ${tone}">${h(rule.severity)}</span>
      ${
        muted
          ? `<span class="bx x mp-click" data-alert-rule-unmute="${h(rule.id)}" title="Muted until ${h(
              F.dateTime(rule.mutedUntil),
            )} — click to unmute">muted</span>`
          : ''
      }
      <span style="flex:1"></span>
      <span class="sw ${rule.enabled ? 'on' : ''}${isAdmin() ? '' : ' ro'}" data-alert-rule-toggle="${h(
        rule.id,
      )}" title="${rule.enabled ? 'Disable' : 'Enable'} this rule"></span>
    </div>
    <small>${meta.label} ${ALERT_OPERATOR_TEXT[rule.operator] || rule.operator} <input class="in" type="number" step="any" value="${
      rule.threshold
    }" data-alert-rule-threshold="${h(rule.id)}" style="width:70px;padding:3px 6px"${disAttr(!isAdmin())}> ${
      meta.unit
    } ${windowText} · cooldown ${F.duration(rule.cooldownSeconds)}</small>
    <div class="row">
      <span class="pill3 on" title="In-app incidents are always recorded">app</span>
      <span class="pill3 ${rule.notifyDiscord ? 'on' : ''}" data-alert-rule-discord="${h(rule.id)}" title="${
        state.alerts.discordConfigured
          ? 'Toggle Discord delivery for this rule'
          : 'Discord is not configured — set DISCORD_WEBHOOK_URL on the API host'
      }" style="${isAdmin() ? '' : 'opacity:.55;cursor:not-allowed'}">discord</span>
      <span class="pill3" title="Email delivery is not configured — no mail transport exists">email</span>
      <span style="flex:1"></span>
      <button class="bt sm dn" data-alert-rule-delete="${h(rule.id)}"${disAttr(!isAdmin())}>Delete</button>
    </div>
  </div>`;
}

function drawAlertChannels(host) {
  const configured = state.alerts.discordConfigured;
  const ev = state.alerts.evaluation || {};
  const cadence = ev.intervalSeconds ?? 10;
  host.innerHTML = `<div class="g12">
    <div class="card s6">
      <div class="ct">Discord <span class="bx ${configured ? 's' : 'x'}">${
        configured ? 'Configured' : 'Not configured'
      }</span></div>
      <input class="in" style="width:100%" disabled value="" placeholder="${
        configured
          ? 'The webhook is configured on the API host and is never exposed here'
          : 'Set DISCORD_WEBHOOK_URL on the API host'
      }">
      <div class="row" style="margin-top:10px">
        ${
          configured
            ? `<button class="bt" data-alert-channel-test="discord"${disAttr(!isAdmin())}>Send test</button>`
            : `<button class="bt" disabled title="Set DISCORD_WEBHOOK_URL on the API host">Send test</button>`
        }
        <span class="m">${
          configured
            ? 'The API delivers notifications; the browser never sees the URL.'
            : 'Delivery is skipped until a webhook is configured.'
        }</span>
      </div>
    </div>
    <div class="card s6">
      <div class="ct">Email <span class="bx x">Not configured</span></div>
      <input class="in" style="width:100%" disabled value="" placeholder="No mail transport is configured">
      <div class="row" style="margin-top:10px">
        <button class="bt" disabled title="Email delivery is not implemented on the API">Send test</button>
        <span class="m">No SMTP transport exists yet, so email alerts are not collected.</span>
      </div>
    </div>
    <div class="card s12">
      <div class="ct">Delivery</div>
      <div class="fm" style="grid-template-columns:220px 1fr">
        <label>Evaluator cadence</label><div>every ${cadence}s</div>
        <label>Opens after</label><div>${ev.triggerEvaluations ?? 2} breaching checks (~${
          (ev.triggerEvaluations ?? 2) * cadence
        }s)</div>
        <label>Resolves after</label><div>${ev.resolveEvaluations ?? 2} healthy checks (~${
          (ev.resolveEvaluations ?? 2) * cadence
        }s)</div>
        <label>Minimum severity</label><div>Per rule — each rule sets its own severity.</div>
        <label>Per-rule channels</label><div>App always on; Discord optional per rule; email unavailable.</div>
        <label>Sound</label><div class="m">Not configured — the dashboard does not play alert sounds.</div>
        <label>Quiet hours</label><div class="m">Not configured — no quiet-hours window is enforced.</div>
      </div>
    </div>
  </div>`;
}

function drawAlertHistory(host) {
  const resolved = (state.alerts.incidents || []).filter((i) => i.status === 'resolved');
  host.innerHTML =
    resolved
      .map((incident) => {
        const tone = F.SEVERITY_TONE[incident.ruleSeverity] || 'w';
        const lasted = F.duration(
          Math.max(0, new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime()) / 1000,
        );
        return `<div class="inc ${incident.ruleSeverity || 'warning'} done">
          <div class="ii">${ic('check')}</div>
          <div class="ib">
            <b>${h(incident.ruleName)}</b>
            <span class="bx ${tone}">${h(incident.ruleSeverity)}</span>
            <p>${h(incident.summary || 'No summary recorded')}</p>
            <small>Opened ${F.ago(incident.startedAt)} · lasted ${lasted} · resolved ${F.ago(
              incident.resolvedAt,
            )}</small>
          </div>
        </div>`;
      })
      .join('') ||
    '<div class="card m" style="text-align:center;padding:30px">Resolved incidents will show up here.</div>';
}

function openRuleForm(rule) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
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
    notifyDiscord: true,
  };
  modal(`<h3>${isEdit ? 'Edit alert rule' : 'New alert rule'}</h3>
    <div class="fm" style="grid-template-columns:170px 1fr">
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
      <label>Discord delivery</label><div><input type="checkbox" id="rf-discord" ${
        value.notifyDiscord ? 'checked' : ''
      }> <span class="m">${
        state.alerts.discordConfigured
          ? 'Send a Discord notification for this rule.'
          : 'Not configured — set DISCORD_WEBHOOK_URL on the API host.'
      }</span></div>
    </div>
    <div class="m" style="margin-top:8px">The evaluation window is only used by the Repeated incidents metric. Other metrics open an incident after ${
      state.alerts.evaluation?.triggerEvaluations ?? 2
    } consecutive breaching checks.</div>
    <div class="row" style="justify-content:flex-end">
      ${isEdit ? '<button class="bt" id="rf-test" title="Sends using the saved rule">Send test</button>' : ''}
      <button class="bt" id="rf-cancel">Cancel</button>
      <button class="bt pr" id="rf-save">${isEdit ? 'Save changes' : 'Create rule'}</button>
    </div>`);
  $('#rf-cancel').addEventListener('click', closeModal);
  const testBtn = $('#rf-test');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      try {
        const result = await apiSend('POST', `${API.alerts}/${encodeURIComponent(rule.id)}/test`);
        toast(result?.message || 'Test notification dispatched');
      } catch (error) {
        reportError(error);
      }
    });
  }
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
      notifyDiscord: $('#rf-discord').checked,
    };
    if (!payload.name) {
      toast('Rule name is required');
      return;
    }
    if (!Number.isFinite(payload.threshold)) {
      toast('Threshold must be a number');
      return;
    }
    if (
      payload.metric === 'repeated_incidents' &&
      (!Number.isInteger(payload.threshold) || payload.threshold < 1)
    ) {
      toast('Incident count must be a whole number of at least 1');
      return;
    }
    if (
      !Number.isInteger(payload.evaluationWindowSeconds) ||
      payload.evaluationWindowSeconds < 10 ||
      payload.evaluationWindowSeconds > 3600
    ) {
      toast('Evaluation window must be 10-3600 seconds');
      return;
    }
    if (
      !Number.isInteger(payload.cooldownSeconds) ||
      payload.cooldownSeconds < 0 ||
      payload.cooldownSeconds > 86400
    ) {
      toast('Cooldown must be 0-86400 seconds');
      return;
    }
    try {
      if (isEdit) await apiSend('PATCH', `${API.alerts}/${encodeURIComponent(rule.id)}`, payload);
      else await apiSend('POST', API.alerts, payload);
      closeModal();
      await refreshAlerts(isEdit ? 'Rule updated' : 'Rule created');
    } catch (error) {
      reportError(error);
    }
  });
}

/** Reload the alerts overview and repaint the current Alerts view. */
async function refreshAlerts(message) {
  try {
    await loadAlerts();
    updateBadges();
    drawAlerts();
    if (message) toast(message);
  } catch (error) {
    reportError(error);
  }
}

/** Refresh only the live KPI/sidebar fields (used by the metrics socket). */
async function refreshAlertLive() {
  try {
    await loadAlerts();
    updateBadges();
    drawAlertKpis();
    drawAlertSidebar();
  } catch {
    /* keep the last good reading; the next push retries */
  }
}

async function patchAlertRule(rule, patch, message) {
  try {
    await apiSend('PATCH', `${API.alerts}/${encodeURIComponent(rule.id)}`, patch);
    await refreshAlerts(message);
  } catch (error) {
    reportError(error);
    await refreshAlerts();
  }
}

async function toggleRule(rule) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  await patchAlertRule(rule, { enabled: !rule.enabled }, rule.enabled ? 'Rule disabled' : 'Rule enabled');
}

async function toggleRuleDiscord(rule) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  const next = !rule.notifyDiscord;
  const message =
    next && !state.alerts.discordConfigured
      ? 'Discord preference saved — configure DISCORD_WEBHOOK_URL to deliver'
      : next
        ? 'Discord delivery enabled for this rule'
        : 'Discord delivery disabled for this rule';
  await patchAlertRule(rule, { notifyDiscord: next }, message);
}

async function unmuteRule(rule) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  try {
    await apiSend('POST', `${API.alerts}/${encodeURIComponent(rule.id)}/unmute`);
    await refreshAlerts('Rule unmuted');
  } catch (error) {
    reportError(error);
  }
}

async function deleteRule(rule) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  if (!window.confirm(`Delete rule "${rule.name}"? Its incidents are deleted too.`)) return;
  try {
    await apiSend('DELETE', `${API.alerts}/${encodeURIComponent(rule.id)}`);
    await refreshAlerts('Rule deleted');
  } catch (error) {
    reportError(error);
  }
}

async function testRule(rule) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  try {
    const result = await apiSend('POST', `${API.alerts}/${encodeURIComponent(rule.id)}/test`);
    toast(result?.message || 'Test notification dispatched');
  } catch (error) {
    reportError(error);
  }
}

async function testDiscordChannel() {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  try {
    const result = await apiSend('POST', `${API.alerts}/channels/discord/test`);
    toast(result?.message || 'Test notification dispatched');
  } catch (error) {
    reportError(error);
  }
}

async function addAlertRule() {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  const metric = $('#nr-metric')?.value || ui.alerts.draft.metric;
  const operator = $('#nr-dir')?.value === 'lt' ? 'lt' : 'gt';
  const threshold = Number($('#nr-threshold')?.value);
  const severity = $('#nr-severity')?.value || 'warning';
  const meta = alertMeta(metric);
  if (!Number.isFinite(threshold)) {
    toast('Threshold must be a number');
    return;
  }
  if (metric === 'repeated_incidents' && (!Number.isInteger(threshold) || threshold < 1)) {
    toast('Incident count must be a whole number of at least 1');
    return;
  }
  const payload = {
    name: `${meta.name} ${operator === 'lt' ? 'low' : 'high'}`,
    metric,
    operator,
    threshold,
    evaluationWindowSeconds: metric === 'repeated_incidents' ? 600 : 60,
    severity,
    cooldownSeconds: 600,
    enabled: true,
    notifyDiscord: true,
  };
  try {
    await apiSend('POST', API.alerts, payload);
    ui.alerts.draft = { metric, dir: operator, threshold: String(threshold), severity };
    await refreshAlerts('Rule added');
  } catch (error) {
    reportError(error);
  }
}

async function runAlertIncidentAction(incident, action) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  const base = `${API.alerts}/incidents/${encodeURIComponent(incident.id)}`;
  if (action === 'delete') {
    if (!window.confirm(`Delete the incident for "${incident.ruleName}"?`)) return;
    try {
      await apiSend('DELETE', base);
      await refreshAlerts('Incident deleted');
    } catch (error) {
      reportError(error);
    }
    return;
  }
  if (action === 'snooze') {
    try {
      await apiSend('POST', `${base}/snooze`, { minutes: 30 });
      await refreshAlerts('Rule snoozed for 30 minutes');
    } catch (error) {
      reportError(error);
    }
    return;
  }
  if (action !== 'ack' && action !== 'resolve') return;
  try {
    await apiSend('POST', `${base}/${action === 'ack' ? 'acknowledge' : 'resolve'}`);
    if (action === 'ack') {
      await refreshAlerts('Incident acknowledged');
      return;
    }
    const status = (state.alerts.ruleStatus || []).find((s) => s.ruleId === incident.alertRuleId);
    await refreshAlerts(
      status?.breaching
        ? 'Incident resolved — the rule is still breaching; its cooldown applies before a new incident'
        : 'Incident resolved',
    );
  } catch (error) {
    reportError(error);
  }
}

async function runAlertBulk(kind) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  if (kind === 'resolve' && !window.confirm('Resolve every open and acknowledged incident?')) return;
  const endpoint = kind === 'ack' ? 'acknowledge-all' : 'resolve-all';
  try {
    const result = await apiSend('POST', `${API.alerts}/incidents/${endpoint}`);
    const count = result?.count ?? 0;
    await refreshAlerts(
      `${kind === 'ack' ? 'Acknowledged' : 'Resolved'} ${count} incident${count === 1 ? '' : 's'}`,
    );
  } catch (error) {
    reportError(error);
  }
}

function onAlertClick(event) {
  const target = event.target;
  if (target.closest('#nr-add')) {
    addAlertRule();
    return;
  }
  if (target.closest('#nr-advanced')) {
    openRuleForm(null);
    return;
  }
  const bulk = target.closest('[data-alert-bulk]');
  if (bulk) {
    runAlertBulk(bulk.dataset.alertBulk);
    return;
  }
  const incidentBtn = target.closest('[data-alert-incident-action]');
  if (incidentBtn) {
    const incident = (state.alerts.incidents || []).find(
      (i) => i.id === incidentBtn.dataset.alertIncident,
    );
    if (incident) runAlertIncidentAction(incident, incidentBtn.dataset.alertIncidentAction);
    return;
  }
  const edit = target.closest('[data-alert-rule-edit]');
  if (edit) {
    const rule = alertRuleFor(edit.dataset.alertRuleEdit);
    if (rule) openRuleForm(rule);
    return;
  }
  const toggle = target.closest('[data-alert-rule-toggle]');
  if (toggle) {
    const rule = alertRuleFor(toggle.dataset.alertRuleToggle);
    if (rule) toggleRule(rule);
    return;
  }
  const discord = target.closest('[data-alert-rule-discord]');
  if (discord) {
    const rule = alertRuleFor(discord.dataset.alertRuleDiscord);
    if (rule) toggleRuleDiscord(rule);
    return;
  }
  const unmute = target.closest('[data-alert-rule-unmute]');
  if (unmute) {
    const rule = alertRuleFor(unmute.dataset.alertRuleUnmute);
    if (rule) unmuteRule(rule);
    return;
  }
  const remove = target.closest('[data-alert-rule-delete]');
  if (remove) {
    const rule = alertRuleFor(remove.dataset.alertRuleDelete);
    if (rule) deleteRule(rule);
    return;
  }
  if (target.closest('[data-alert-channel-test="discord"]')) testDiscordChannel();
}

function onAlertChange(event) {
  const target = event.target;
  if (target.id === 'af-status') {
    ui.alerts.filter = target.value;
    drawAlertBody();
    return;
  }
  if (target.id === 'af-sev') {
    ui.alerts.severity = target.value;
    drawAlertBody();
    return;
  }
  if (target.id === 'nr-metric') {
    const meta = alertMeta(target.value);
    ui.alerts.draft = {
      metric: target.value,
      dir: meta.dir,
      threshold: String(meta.threshold),
      severity: ui.alerts.draft.severity,
    };
    drawAlertBody();
    return;
  }
  if (target.id === 'nr-dir') {
    ui.alerts.draft.dir = target.value;
    return;
  }
  if (target.id === 'nr-threshold') {
    ui.alerts.draft.threshold = target.value;
    return;
  }
  if (target.id === 'nr-severity') {
    ui.alerts.draft.severity = target.value;
    return;
  }
  const threshold = target.closest('[data-alert-rule-threshold]');
  if (threshold) {
    const rule = alertRuleFor(threshold.dataset.alertRuleThreshold);
    const value = Number(target.value);
    if (!rule) return;
    if (!Number.isFinite(value)) {
      toast('Threshold must be a number');
      drawAlertBody();
      return;
    }
    if (value !== rule.threshold) patchAlertRule(rule, { threshold: value }, 'Threshold updated');
    return;
  }
  const windowEl = target.closest('[data-alert-rule-window]');
  if (windowEl) {
    const rule = alertRuleFor(windowEl.dataset.alertRuleWindow);
    const value = Number(target.value);
    if (!rule) return;
    if (!Number.isInteger(value) || value < 10 || value > 3600) {
      toast('Window must be 10-3600 seconds');
      drawAlertBody();
      return;
    }
    if (value !== rule.evaluationWindowSeconds) {
      patchAlertRule(rule, { evaluationWindowSeconds: value }, 'Window updated');
    }
  }
}

function onAlertInput(event) {
  if (event.target.id !== 'aq') return;
  ui.alerts.q = event.target.value;
  const caret = event.target.selectionStart;
  drawAlertBody();
  const input = $('#aq');
  if (input) {
    input.focus();
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      /* selection unsupported */
    }
  }
}

function onAlertKeydown(event) {
  if (event.key !== 'Enter') return;
  if (event.target.matches('[data-alert-rule-threshold],[data-alert-rule-window]')) {
    event.preventDefault();
    event.target.blur();
  }
}

function onAlertSideKeydown(event) {
  if (event.target.id === 'abc' && event.key === 'Enter') {
    event.preventDefault();
    sendBroadcast(event.target.value);
  }
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function settingsDefaults() {
  const source = state.settings?.defaults || {};
  const defaults = {};
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    const value = Number(source[field.key]);
    defaults[field.key] = Number.isFinite(value) ? value : SETTINGS_FALLBACK_DEFAULTS[field.key];
  }
  return defaults;
}

function settingsDraftFromState() {
  const saved = state.settings || {};
  const defaults = settingsDefaults();
  const draft = { serverName: state.server?.name || '' };
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    draft[field.key] = String(saved[field.key] ?? defaults[field.key]);
  }
  return draft;
}

function ensureSettingsDraft() {
  if (!ui.settings.draft || !ui.settings.dirty) ui.settings.draft = settingsDraftFromState();
  return ui.settings.draft;
}

function captureSettingsDraft() {
  const draft = ensureSettingsDraft();
  const nameInput = $('#st-name');
  if (nameInput) draft.serverName = nameInput.value;
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    const input = document.getElementById(field.id);
    if (input) draft[field.key] = input.value;
  }
  return draft;
}

function draftHasChanges() {
  const saved = settingsDraftFromState();
  const draft = ui.settings.draft || saved;
  if (String(draft.serverName ?? '') !== saved.serverName) return true;
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    if (String(draft[field.key] ?? '').trim() !== saved[field.key]) return true;
  }
  return false;
}

function updateSettingsDirtyLabel() {
  const label = $('#dirty');
  if (label) label.textContent = ui.settings.dirty ? 'Unsaved changes' : '';
}

function validateSettingsDraft(draft) {
  const values = {};
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    const value = Number(String(draft[field.key] ?? '').trim());
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      return {
        error: `${field.label} must be a whole number between ${field.min} and ${field.max}`,
      };
    }
    values[field.key] = value;
  }
  const name = String(draft.serverName ?? '').trim();
  if (!name) return { error: 'Server name is required' };
  if (name.length > 80) return { error: 'Server name must be 80 characters or fewer' };
  if (values.heartbeatOfflineSeconds <= values.heartbeatStaleSeconds) {
    return { error: 'Offline threshold must be greater than the stale threshold' };
  }
  return { values, name };
}

async function saveSettings() {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  if (ui.settings.saving) {
    toast('Save already in progress');
    return;
  }

  const draft = captureSettingsDraft();
  const result = validateSettingsDraft(draft);
  if (result.error) {
    toast(result.error);
    return;
  }

  const saved = state.settings || {};
  const patch = {};
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    if (Number(saved[field.key]) !== result.values[field.key]) {
      patch[field.key] = result.values[field.key];
    }
  }
  const nameChanged = result.name !== (state.server?.name || '');
  if (!Object.keys(patch).length && !nameChanged) {
    ui.settings.dirty = draftHasChanges();
    updateSettingsDirtyLabel();
    toast('No changes to save');
    return;
  }

  ui.settings.saving = true;
  try {
    if (Object.keys(patch).length) {
      state.settings = await apiSend('PATCH', API.settings, patch);
    }
    if (nameChanged) {
      state.server = await apiSend('PATCH', API.serverProfile, { name: result.name });
    }
    ui.settings.dirty = false;
    ui.settings.draft = null;
    toast('Settings saved');
    rerender();
  } catch (error) {
    reportError(error);
  } finally {
    ui.settings.saving = false;
  }
}

async function resetSettings() {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  if (ui.settings.saving) {
    toast('A settings change is already in progress');
    return;
  }
  if (!window.confirm('Restore retention, threshold and display defaults? The server display name is kept.')) {
    return;
  }

  ui.settings.saving = true;
  try {
    const defaults = settingsDefaults();
    const patch = {};
    for (const field of SETTINGS_NUMERIC_FIELDS) patch[field.key] = defaults[field.key];
    state.settings = await apiSend('PATCH', API.settings, patch);
    resetDisplayPreferences();
    ui.settings.dirty = false;
    ui.settings.draft = null;
    toast('Defaults restored');
    rerender();
  } catch (error) {
    reportError(error);
  } finally {
    ui.settings.saving = false;
  }
}

const settingsCard = (title, description, body) =>
  `<div class="card sc2"><div class="sct">${title}<small>${description}</small></div>${body}</div>`;

const settingsRow = (title, description, control) =>
  `<div class="srw"><div><b>${title}</b><small>${description}</small></div><div>${control}</div></div>`;

const settingsBadge = (on, yes = 'Active', no = 'Unavailable') =>
  `<span class="bx ${on ? 's' : 'x'}">${yes}</span>`;

const settingsReadOnlySwitch = (on, reason) =>
  `<span class="sw ${on ? 'on' : ''} ro" title="${h(reason)}" aria-disabled="true"></span>`;

const settingsLiveSwitch = () =>
  `<span class="sw ${display.live ? 'on' : ''}" data-live-toggle role="switch" aria-checked="${display.live}" title="${
    display.live ? 'Pause live updates' : 'Resume live updates'
  }"></span>`;

function settingsFieldInput(field, draft) {
  return `<div class="row"><input class="in" type="number" id="${field.id}" data-setting="${field.key}" min="${
    field.min
  }" max="${field.max}" step="1" value="${h(draft[field.key])}"${disAttr(!isAdmin())}><span class="m">${
    field.unit
  }</span></div>`;
}

function settingsPrefSelect(id, pref, options, value) {
  return `<select class="in" id="${id}" data-pref="${pref}">${options
    .map(
      ([key, label]) =>
        `<option value="${key}"${key === value ? ' selected' : ''}>${label}</option>`,
    )
    .join('')}</select>`;
}

function settingsGeneral() {
  const server = state.server || {};
  const status = state.status || {};
  const metrics = state.metrics || {};
  const draft = ensureSettingsDraft();
  const address = serverAddress();
  const minecraftVersion = status.minecraftVersion || server.minecraftVersion;
  const software = status.software || server.software;
  const connected = Boolean(status.agentConnected);
  let timezone = 'Browser local time';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {
    /* keep fallback */
  }

  return `${settingsCard(
    'Server profile',
    'Identity shown across the dashboard',
    settingsRow(
      'Display name',
      'Stored by MinePulse; used in the sidebar and dashboards.',
      `<input class="in" id="st-name" data-setting="serverName" maxlength="80" value="${h(
        draft.serverName,
      )}"${disAttr(!isAdmin())}>`,
    ) +
      settingsRow(
        'Server address',
        'Reported by the agent from the server configuration.',
        `<div class="row"><input class="in" readonly value="${h(address || '')}" placeholder="${
          address ? '' : 'Not reported by the agent'
        }"><button class="bt" data-act="copy-address"${
          address ? '' : ' disabled'
        }>Copy</button></div>`,
      ) +
      settingsRow(
        'Software',
        'Reported by the running server.',
        `<span>${h(software || 'Not reported yet')}</span>`,
      ) +
      settingsRow(
        'Minecraft version',
        'Reported by the running server.',
        `<span>${h(minecraftVersion || 'Not reported yet')}</span>`,
      ) +
      settingsRow(
        'Message of the day',
        'The agent does not report the MOTD.',
        `${settingsBadge(false, 'Collected', 'Not collected')} <span class="m">Edit server.properties on the host.</span>`,
      ) +
      settingsRow(
        'Time zone',
        'Dashboard timestamps use this browser time zone.',
        `<span>${h(timezone)}</span> <span class="m">(this device)</span>`,
      ) +
      settingsRow(
        'Added to MinePulse',
        'When this server record was created.',
        `<span>${server.createdAt ? F.dateTime(server.createdAt) : 'Unknown'}</span>`,
      ),
  )}${settingsCard(
    'Agent connection',
    'Live telemetry source for this server',
    settingsRow(
      'Connectivity',
      connected ? 'A heartbeat arrived within the configured window.' : 'No recent heartbeat from the agent.',
      settingsBadge(connected, 'Connected', 'Disconnected'),
    ) +
      settingsRow(
        'Agent version',
        'Reported with the latest heartbeat.',
        `<span>${h(metrics.agentVersion || 'Not reported yet')}</span>`,
      ) +
      settingsRow(
        'Last heartbeat',
        'When the API last received telemetry.',
        status.lastHeartbeatAt
          ? `${F.ago(status.lastHeartbeatAt)} <span class="m">(${F.dateTime(status.lastHeartbeatAt)})</span>`
          : 'No heartbeat yet',
      ) +
      settingsRow(
        'Data freshness',
        'Age of the latest metric sample.',
        status.dataFreshnessSeconds == null ? 'No sample yet' : F.duration(status.dataFreshnessSeconds),
      ) +
      settingsRow(
        'Socket stream',
        'Realtime dashboard connection.',
        settingsBadge(state.socketConnected, 'Connected', 'Disconnected'),
      ),
  )}`;
}

function settingsMonitoring() {
  const draft = ensureSettingsDraft();
  const sample = state.metrics?.sample || {};
  const has = (value) => Array.isArray(value) && value.length > 0;
  const retention = SETTINGS_NUMERIC_FIELDS.filter((field) => field.unit === 'days');
  const thresholds = SETTINGS_NUMERIC_FIELDS.filter((field) => field.unit === 'seconds');

  return `${settingsCard(
    'Live updates',
    'Control realtime dashboard repaints',
    settingsRow(
      'Live updates',
      display.live
        ? 'Incoming telemetry repaints pages as it arrives.'
        : 'Telemetry is stored, but pages do not repaint until live updates are resumed.',
      settingsLiveSwitch(),
    ),
  )}${settingsCard(
    'Data retention',
    'How long each dataset is kept before the scheduled sweep',
    retention.map((field) => settingsRow(field.label, field.hint, settingsFieldInput(field, draft))).join(''),
  )}${settingsCard(
    'Status thresholds',
    'Used by server state and offline alerts',
    thresholds.map((field) => settingsRow(field.label, field.hint, settingsFieldInput(field, draft))).join('') +
      settingsRow(
        'Tick spike threshold',
        'The dashboard highlights samples above the fixed tick budget.',
        '<span class="bx i">Fixed</span> <span class="m">50 ms in v1</span>',
      ),
  )}${settingsCard(
    'Collection features',
    'What the agent reports with each telemetry sample',
    settingsRow(
      'Garbage collection',
      'Collector names, counts and pause times.',
      settingsBadge(has(sample.gc), 'Reporting', 'No samples yet'),
    ) +
      settingsRow(
        'Plugin timings',
        'Per-plugin tick cost when the agent provides it.',
        settingsBadge(has(sample.pluginTickCost), 'Reporting', 'No samples yet'),
      ) +
      settingsRow(
        'Tick profiler',
        'Timing breakdown for the current tick.',
        settingsBadge(has(sample.tickBreakdown), 'Reporting', 'No samples yet'),
      ) +
      settingsRow(
        'Telemetry interval',
        'The agent controls its own sample cadence; the dashboard receives a push stream, not a polling interval.',
        '<span class="m">Agent-configured</span>',
      ),
  )}`;
}

function settingsNotifications() {
  const configured = Boolean(
    state.settings?.discordConfigured ?? state.alerts?.discordConfigured,
  );
  const evaluation = state.alerts?.evaluation || {};
  const cadence = evaluation.intervalSeconds;

  return `${settingsCard(
    'Channels',
    'Delivery targets for alert incidents',
    settingsRow(
      'Discord',
      'Configured by DISCORD_WEBHOOK_URL on the API host. The webhook is never sent to this browser.',
      `${settingsBadge(configured, 'Configured', 'Not configured')} ${settingsReadOnlySwitch(
        configured,
        configured ? 'Controlled by DISCORD_WEBHOOK_URL on the API host' : 'No webhook configured',
      )}`,
    ) +
      settingsRow(
        'Webhook URL',
        'Server-side secret; intentionally not displayed.',
        `<input class="in" disabled value="" placeholder="${
          configured ? 'Hidden - configured on the API host' : 'Set DISCORD_WEBHOOK_URL on the API host'
        }">`,
      ) +
      settingsRow(
        'Discord test',
        'Sends a real test message through the API.',
        `<button class="bt" data-act="discord-test"${
          configured ? disAttr(!isAdmin()) : ' disabled title="Set DISCORD_WEBHOOK_URL on the API host"'
        }>Send test</button>`,
      ) +
      settingsRow(
        'Email',
        'No SMTP transport is configured in this build.',
        `${settingsBadge(false, 'Configured', 'Not configured')} ${settingsReadOnlySwitch(
          false,
          'No mail transport is configured',
        )}`,
      ) +
      settingsRow(
        'Email recipients',
        'Nothing to send to until a transport exists.',
        '<input class="in" disabled value="" placeholder="No email transport configured">',
      ) +
      settingsRow(
        'Alert sound',
        'The dashboard does not play alert sounds.',
        settingsReadOnlySwitch(false, 'Not implemented in this build'),
      ),
  )}${settingsCard(
    'Delivery',
    'How incident notifications are evaluated',
    settingsRow(
      'Minimum severity',
      'Set per alert rule on the Alerts page.',
      '<button class="bt" data-act="open-alert-rules">Open alert rules</button>',
    ) +
      settingsRow(
        'Evaluation cadence',
        'The alert evaluator runs on the API; delivery follows each rule.',
        cadence == null
          ? '<span class="m">Not loaded</span>'
          : `<span>${h(String(cadence))}s</span> <span class="m">(${h(
              String(evaluation.triggerEvaluations ?? '-'),
            )} trigger / ${h(String(evaluation.resolveEvaluations ?? '-'))} resolve samples)</span>`,
      ) +
      settingsRow(
        'Quiet hours',
        'Not configured. Snooze an incident or mute a rule instead.',
        '<button class="bt" data-act="open-alert-incidents">Open incidents</button>',
      ) +
      settingsRow(
        'Per-rule channels',
        'Each rule owns its severity, cooldown and delivery state.',
        '<button class="bt" data-act="open-alert-channels">Open channels</button>',
      ),
  )}`;
}

function settingsDisplay() {
  const swatches = Object.entries(ACCENTS)
    .map(
      ([key, accent]) =>
        `<span class="swt ${display.accent === key ? 'on' : ''}" data-accent="${key}" title="${
          accent.label
        }" aria-label="${accent.label}" style="background:${accent.color}"></span>`,
    )
    .join('');

  return `${settingsCard(
    'Appearance',
    'These preferences are stored in this browser and apply immediately',
    settingsRow('Accent colour', 'Used for highlights, charts and active states.', `<div class="row">${swatches}</div>`) +
      settingsRow(
        'Density',
        'Compact reduces spacing across the dashboard.',
        settingsPrefSelect(
          'st-density',
          'density',
          [
            ['comfortable', 'Comfortable'],
            ['compact', 'Compact'],
          ],
          display.density,
        ),
      ) +
      settingsRow(
        'Theme',
        'Dark is the default; light mode switches the palette.',
        settingsPrefSelect(
          'st-theme',
          'theme',
          [
            ['dark', 'Dark'],
            ['light', 'Light'],
          ],
          display.theme,
        ),
      ) +
      settingsRow(
        'Open on start',
        'The page shown after sign-in on this browser.',
        settingsPrefSelect('st-start', 'start', START_PAGES, display.start),
      ),
  )}`;
}

function settingsData() {
  const exportJson = JSON.stringify(settingsExportPayload(), null, 2);
  const rangeSelect = `<select class="in" id="st-export-range">${RANGES.map(
    (range) => `<option value="${range}"${range === ui.range ? ' selected' : ''}>${range}</option>`,
  ).join('')}</select>`;

  return `${settingsCard(
    'Backup',
    'Move settings between dashboards',
    settingsRow(
      'Export settings',
      'Saved monitoring values and display preferences. Never includes tokens or credentials.',
      '<div class="row"><button class="bt" data-act="export-settings">Download JSON</button><button class="bt" data-copy-settings>Copy JSON</button></div>',
    ) +
      `<div style="padding:0 16px 14px"><textarea class="in" readonly style="width:100%;min-height:150px;font-family:ui-monospace,Consolas,monospace" id="st-export-json">${h(
        exportJson,
      )}</textarea></div>` +
      `<div class="srw"><div><b>Import settings</b><small>Paste an exported JSON document. Only known monitoring and display fields are applied.</small></div><div><textarea class="in" id="st-import" placeholder="Paste exported JSON" style="min-height:70px"></textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="bt pr" data-act="import-settings"${disAttr(
        !isAdmin(),
      )}>Import</button></div></div></div>`,
  )}${settingsCard(
    'CSV exports',
    'Authorized downloads of the stored data',
    settingsRow(
      'Metrics history',
      'Exports the selected range as CSV.',
      `<div class="row">${rangeSelect}<button class="bt" data-act="export-metrics" data-range-source="st-export-range">Export metrics</button></div>`,
    ) +
      settingsRow(
        'Events',
        'Uses the severity and search filters currently set on Events & Logs.',
        '<button class="bt" data-act="export-events">Export events</button>',
      ),
  )}${settingsCard(
    'Maintenance',
    'Scheduled jobs and destructive actions',
    settingsRow(
      'Retention sweep',
      'Runs automatically every 6 hours. This executes the saved policy now.',
      `<button class="bt" data-act="run-retention"${disAttr(!isAdmin())}>Run now</button>`,
    ) +
      settingsRow(
        'Reset settings',
        'Restores retention, threshold and display defaults. The server display name is kept.',
        `<button class="bt dn" data-act="reset-settings"${disAttr(!isAdmin())}>Reset defaults</button>`,
      ) +
      settingsRow(
        'Clear event log',
        'Not exposed: event history is retained by the retention policy.',
        '<button class="bt" disabled title="Not implemented">Clear</button>',
      ),
  )}`;
}

function settingsCredentialRows(credentials) {
  if (!credentials.length) {
    return settingsRow(
      'No agent credentials',
      'Create one below and add it to the agent configuration.',
      '<span class="m">None</span>',
    );
  }
  return credentials
    .map((credential) => {
      const label = credential.label || 'Unnamed credential';
      return settingsRow(
        h(label),
        `${h(credential.tokenPrefix)}... &middot; created ${F.dateTime(
          credential.createdAt,
        )} &middot; ${credential.lastUsedAt ? `last used ${F.ago(credential.lastUsedAt)}` : 'never used'}`,
        `<div class="row"><span class="bx ${credential.revokedAt ? 'x' : 's'}">${
          credential.revokedAt ? 'Revoked' : 'Active'
        }</span>${
          credential.revokedAt
            ? ''
            : `<button class="bt dn" data-credential-revoke="${h(
                credential.id,
              )}" data-credential-label="${h(label)}" data-credential-prefix="${h(
                credential.tokenPrefix,
              )}">Revoke</button>`
        }</div>`,
      );
    })
    .join('');
}

function settingsSecurity() {
  if (!isAdmin()) {
    return settingsCard(
      'Admin access required',
      'Security details are restricted',
      settingsRow(
        'Restricted',
        'Sign in as an admin to view sessions, agent credentials and team accounts.',
        '<span class="bx i">Read only</span>',
      ),
    );
  }
  if (ui.settings.securityError) {
    return settingsCard(
      'Security',
      'Could not load security data',
      settingsRow(h('Load failed'), h(ui.settings.securityError), '<button class="bt" data-act="reload-security">Retry</button>'),
    );
  }
  if (!state.security) {
    return settingsCard(
      'Security',
      'Session, agent credentials and team accounts',
      settingsRow(
        ui.settings.securityLoading ? 'Loading security data' : 'Security data not loaded',
        'Agent credentials and session metadata are read from the API.',
        ui.settings.securityLoading
          ? '<span class="m">Loading...</span>'
          : '<button class="bt" data-act="reload-security">Load</button>',
      ),
    );
  }

  const security = state.security;
  const credentials = security.agentCredentials || [];
  const active = credentials.filter((credential) => !credential.revokedAt);
  const team = security.team || [];

  return `${settingsCard(
    'API access',
    'Agent credentials are hashed at rest; existing tokens are never returned',
    settingsRow(
      'API bind address',
      'Where the API listens. Change API_BIND on the host and restart the API.',
      `<span>${h(security.apiBind)}</span>`,
    ) +
      settingsRow(
        'Active credentials',
        'Revoking the credential the agent uses will stop telemetry until it is replaced.',
        `<span class="bx ${active.length ? 's' : 'x'}">${active.length} active</span> <span class="m">/ ${credentials.length} total</span>`,
      ) +
      settingsCredentialRows(credentials) +
      `<div class="srw"><div><b>Create credential</b><small>The raw token is shown once. Copy it into the agent configuration.</small></div><div><div class="row"><input class="in" id="st-cred-label" maxlength="60" placeholder="Label (optional)"><button class="bt pr" data-act="create-credential">Create</button></div></div></div>`,
  )}${settingsCard(
    'Sign-in',
    'Your current dashboard session',
    settingsRow(
      'Signed in as',
      'Dashboard account for this session.',
      `<span>${h(state.user?.email || 'Unknown')}</span> <span class="bx i">${h(
        roleLabel(state.user?.role),
      )}</span>`,
    ) +
      settingsRow('Session started', 'Created when you signed in.', F.dateTime(security.session.createdAt)) +
      settingsRow('Last used', 'Updated by authenticated requests.', F.dateTime(security.session.lastUsedAt)) +
      settingsRow(
        'Expires',
        'Sessions have a fixed lifetime; sign in again after this time.',
        F.dateTime(security.session.expiresAt),
      ) +
      settingsRow(
        'Session timeout',
        'Configured by the API session policy.',
        `<span>${F.duration(security.sessionTtlSeconds)}</span>`,
      ) +
      settingsRow(
        'Two-factor authentication',
        'Not implemented in this build.',
        settingsReadOnlySwitch(false, 'No two-factor endpoint exists'),
      ),
  )}${settingsCard(
    'Team',
    'Dashboard accounts stored by the API',
    team
      .map((member) =>
        settingsRow(
          h(member.email),
          `Joined ${F.dateTime(member.createdAt)}`,
          `<span class="bx ${member.role === 'admin' ? 's' : 'i'}">${h(roleLabel(member.role))}</span>`,
        ),
      )
      .join('') +
      settingsRow(
        'Account management',
        'Accounts and roles are provisioned on the API host; this build has no invite or role-management endpoint.',
        '<span class="m">CLI only</span>',
      ),
  )}${settingsCard(
    'Network',
    'How the API is exposed',
    settingsRow(
      'CORS origins',
      'Configured with CORS_ORIGINS; the dashboard never receives the list.',
      '<span class="m">Server-side configuration</span>',
    ) +
      settingsRow(
        'IP allowlist',
        'Not configured. Use a reverse proxy or firewall if remote access is required.',
        '<span class="m">Not configured</span>',
      ),
  )}`;
}

function settingsBody() {
  if (ui.settings.tab === 'mon') return settingsMonitoring();
  if (ui.settings.tab === 'not') return settingsNotifications();
  if (ui.settings.tab === 'disp') return settingsDisplay();
  if (ui.settings.tab === 'sec') return settingsSecurity();
  if (ui.settings.tab === 'data') return settingsData();
  return settingsGeneral();
}

function drawSettingsBody(root = document) {
  const host = $('#st-body', root);
  if (!host) return;
  host.innerHTML = settingsBody();
  bindSettingsBody(host);
}

function bindSettingsBody(host) {
  if (host.dataset.bound === '1') return;
  host.dataset.bound = '1';
  host.addEventListener('input', handleSettingsInput);
  host.addEventListener('change', handleSettingsInput);
  host.addEventListener('click', handleSettingsBodyClick);
}

function handleSettingsInput(event) {
  const target = event.target;
  if (target.matches('[data-setting]')) {
    const draft = ensureSettingsDraft();
    if (target.id === 'st-name') {
      draft.serverName = target.value;
    } else {
      const field = SETTINGS_NUMERIC_FIELDS.find((entry) => entry.id === target.id);
      if (field) draft[field.key] = target.value;
    }
    ui.settings.dirty = draftHasChanges();
    updateSettingsDirtyLabel();
    return;
  }
  if (event.type !== 'change' || !target.matches('[data-pref]')) return;

  const pref = target.dataset.pref;
  if (pref === 'density') {
    display.density = target.value === 'compact' ? 'compact' : 'comfortable';
  } else if (pref === 'start' && START_PAGES.some(([key]) => key === target.value)) {
    display.start = target.value;
  } else if (pref === 'theme') {
    display.theme = target.value === 'light' ? 'light' : 'dark';
  } else {
    return;
  }
  applyDisplayPreferences();
  saveDisplayPreferences();
}

function handleSettingsBodyClick(event) {
  const accent = event.target.closest('[data-accent]');
  if (accent) {
    if (ACCENTS[accent.dataset.accent]) {
      display.accent = accent.dataset.accent;
      applyDisplayPreferences();
      saveDisplayPreferences();
      drawSettingsBody();
    }
    return;
  }

  const live = event.target.closest('[data-live-toggle]');
  if (live) {
    toggleLiveUpdates();
    return;
  }

  const revoke = event.target.closest('[data-credential-revoke]');
  if (revoke) {
    revokeAgentCredential(
      revoke.dataset.credentialRevoke,
      revoke.dataset.credentialLabel || '',
      revoke.dataset.credentialPrefix || '',
    );
    return;
  }

  if (event.target.closest('[data-copy-settings]')) {
    copyText(JSON.stringify(settingsExportPayload(), null, 2), 'Settings JSON copied');
  }
}

function toggleLiveUpdates() {
  display.live = !display.live;
  saveDisplayPreferences();
  toast(display.live ? 'Live updates resumed' : 'Live updates paused');
  drawSettingsBody();
  if (display.live) refreshAll(false);
}

function settingsExportPayload() {
  const saved = state.settings || {};
  const defaults = settingsDefaults();
  const values = {};
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    values[field.key] = Number(saved[field.key] ?? defaults[field.key]);
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: values,
    display: {
      accent: display.accent,
      density: display.density,
      start: display.start,
      theme: display.theme,
      live: display.live,
    },
  };
}

function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportSettings() {
  const date = new Date().toISOString().slice(0, 10);
  downloadText(
    `minepulse-settings-${date}.json`,
    JSON.stringify(settingsExportPayload(), null, 2),
  );
  toast('Settings exported');
}

async function importSettings() {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  const raw = $('#st-import')?.value?.trim();
  if (!raw) {
    toast('Paste an exported JSON document first');
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    toast('That is not valid JSON');
    return;
  }

  const source =
    data && typeof data === 'object' && data.settings && typeof data.settings === 'object'
      ? data.settings
      : data;
  const patch = {};
  let settingCount = 0;
  for (const field of SETTINGS_NUMERIC_FIELDS) {
    if (!source || typeof source !== 'object' || !(field.key in source)) continue;
    settingCount += 1;
    const value = Number(source[field.key]);
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      toast(`${field.label} must be a whole number between ${field.min} and ${field.max}`);
      return;
    }
    patch[field.key] = value;
  }

  const stale =
    patch.heartbeatStaleSeconds ??
    Number(state.settings?.heartbeatStaleSeconds ?? settingsDefaults().heartbeatStaleSeconds);
  const offline =
    patch.heartbeatOfflineSeconds ??
    Number(state.settings?.heartbeatOfflineSeconds ?? settingsDefaults().heartbeatOfflineSeconds);
  if (offline <= stale) {
    toast('Offline threshold must be greater than the stale threshold');
    return;
  }

  const displaySource =
    data && typeof data === 'object' && data.display && typeof data.display === 'object'
      ? data.display
      : null;
  const nextDisplay = {};
  if (displaySource) {
    if (displaySource.accent != null) {
      if (!ACCENTS[displaySource.accent]) {
        toast('Unknown accent colour in this file');
        return;
      }
      nextDisplay.accent = displaySource.accent;
    }
    if (displaySource.density != null) {
      if (displaySource.density !== 'compact' && displaySource.density !== 'comfortable') {
        toast('Unknown density in this file');
        return;
      }
      nextDisplay.density = displaySource.density;
    }
    if (displaySource.start != null) {
      if (!START_PAGES.some(([key]) => key === displaySource.start)) {
        toast('Unknown start page in this file');
        return;
      }
      nextDisplay.start = displaySource.start;
    }
    if (displaySource.theme != null) {
      if (displaySource.theme !== 'light' && displaySource.theme !== 'dark') {
        toast('Unknown theme in this file');
        return;
      }
      nextDisplay.theme = displaySource.theme;
    }
    if (displaySource.live != null) {
      if (typeof displaySource.live !== 'boolean') {
        toast('Invalid live-update preference in this file');
        return;
      }
      nextDisplay.live = displaySource.live;
    }
  }

  if (!settingCount && !Object.keys(nextDisplay).length) {
    toast('No recognized settings found in this file');
    return;
  }

  try {
    if (settingCount) {
      state.settings = await apiSend('PATCH', API.settings, patch);
    }
    if (Object.keys(nextDisplay).length) {
      Object.assign(display, nextDisplay);
      applyDisplayPreferences();
      saveDisplayPreferences();
    }
    ui.settings.dirty = false;
    ui.settings.draft = null;
    toast('Settings imported');
    rerender();
  } catch (error) {
    reportError(error);
  }
}

async function runRetentionNow() {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  if (!window.confirm('Run the retention sweep now? This permanently removes data outside the saved retention windows.')) {
    return;
  }
  try {
    const counts = await apiSend('POST', API.settingsRetention);
    modal(`<h3>Retention sweep complete</h3>
      <div style="margin-top:10px">${rows([
        ['Raw metric samples', F.num(counts.metricSamples)],
        ['1-minute rollups', F.num(counts.aggregates1m)],
        ['1-hour rollups', F.num(counts.aggregates1h)],
        ['Server events', F.num(counts.events)],
        ['Player sessions', F.num(counts.playerSessions)],
      ])}</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="bt pr" id="st-retention-close">Done</button></div>`);
    $('#st-retention-close')?.addEventListener('click', closeModal);
    toast('Retention sweep complete');
  } catch (error) {
    reportError(error);
  }
}

async function loadSettingsSecurity(force = false) {
  if (!isAdmin()) return;
  if (ui.settings.securityLoading) return;
  if (state.security && !force) return;

  ui.settings.securityLoading = true;
  ui.settings.securityError = null;
  if (ui.page === 'settings' && ui.settings.tab === 'sec') drawSettingsBody();
  try {
    state.security = await apiGet(API.settingsSecurity);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showLogin();
      return;
    }
    ui.settings.securityError = error?.message || 'Failed to load security data';
  } finally {
    ui.settings.securityLoading = false;
    if (ui.page === 'settings' && ui.settings.tab === 'sec') drawSettingsBody();
  }
}

async function createAgentCredential() {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  const label = ($('#st-cred-label')?.value || '').trim();
  if (label.length > 60) {
    toast('Label must be 60 characters or fewer');
    return;
  }

  try {
    const result = await apiSend(
      'POST',
      API.settingsCredentials,
      label ? { label } : {},
    );
    const token = result.token;
    modal(`<h3>Agent credential created</h3>
      <p class="m" style="margin:6px 0 10px">Copy this token now. It will not be shown again.</p>
      <div style="word-break:break-all;user-select:all;padding:10px;border:1px solid var(--ln);border-radius:6px;background:#0a1d1f">${h(
        token,
      )}</div>
      <p class="m" style="margin-top:10px">Add it to the agent configuration and restart the agent that uses it.</p>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="bt" id="st-copy-token">Copy token</button><button class="bt pr" id="st-close-token">Done</button></div>`);
    $('#st-copy-token')?.addEventListener('click', () => copyText(token, 'Token copied'));
    $('#st-close-token')?.addEventListener('click', closeModal);
    state.security = null;
    await loadSettingsSecurity(true);
    toast('Credential created');
  } catch (error) {
    reportError(error);
  }
}

async function revokeAgentCredential(id, label, prefix) {
  if (!isAdmin()) {
    toast('Admin access required');
    return;
  }
  if (!id) return;
  const name = label || `${prefix}...`;
  if (
    !window.confirm(
      `Revoke ${name}? The agent using it will stop reporting until you install a replacement credential.`,
    )
  ) {
    return;
  }

  try {
    await apiSend(
      'POST',
      `${API.settingsCredentials}/${encodeURIComponent(id)}/revoke`,
    );
    state.security = null;
    toast('Credential revoked');
    await loadSettingsSecurity(true);
  } catch (error) {
    reportError(error);
  }
}

async function copyText(text, message) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast(message);
      return;
    }
  } catch {
    /* fall back to a temporary selection */
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    toast(copied ? message : 'Copy failed - select the text manually');
  } catch {
    toast('Copy failed - select the text manually');
  }
}

PAGES.settings = {
  render() {
    if (!state.settings) {
      return `<div class="pgw">
        <div class="ph2"><div><h2>Settings</h2><p>Manage how MinePulse monitors and displays your server</p></div></div>
        <div class="card"><div class="sec">Settings</div>${empty(
          'Settings could not be loaded.',
        )}<div class="row" style="padding:12px"><button class="bt" data-act="refresh">Retry</button></div></div>
      </div>`;
    }

    return `<div class="pgw">
      <div class="ph2">
        <div><h2>Settings</h2><p>Manage how MinePulse monitors and displays your server</p></div>
        <div class="tools">
          <span class="y" id="dirty">${ui.settings.dirty ? 'Unsaved changes' : ''}</span>
          <button class="bt" data-act="reset-settings"${disAttr(!isAdmin())}>Reset defaults</button>
          <button class="bt pr" data-act="save-settings"${disAttr(!isAdmin())}>Save changes</button>
        </div>
      </div>
      <div class="sx">
        <div class="sn" id="sn">${SETTINGS_SECTIONS.map(
          ([key, label, subtitle]) =>
            `<a data-settings-tab="${key}" class="${
              ui.settings.tab === key ? 'on' : ''
            }"><b>${label}</b><small>${subtitle}</small></a>`,
        ).join('')}</div>
        <div id="st-body"></div>
      </div>
    </div>`;
  },
  mount(root) {
    const nav = $('#sn', root);
    if (nav) {
      nav.addEventListener('click', (event) => {
        const link = event.target.closest('[data-settings-tab]');
        if (!link) return;
        captureSettingsDraft();
        ui.settings.tab = link.dataset.settingsTab;
        $$('#sn a', root).forEach((item) =>
          item.classList.toggle('on', item.dataset.settingsTab === ui.settings.tab),
        );
        drawSettingsBody(root);
        if (ui.settings.tab === 'sec' && isAdmin()) loadSettingsSecurity();
      });
    }
    drawSettingsBody(root);
    if (ui.settings.tab === 'sec' && isAdmin()) loadSettingsSecurity();
  },
};

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
  plugin_enable: 'Enable plugin',
  plugin_disable: 'Disable plugin',
  plugin_reload: 'Reload plugin',
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
  plugin_enable: 's',
  plugin_disable: 'w',
  plugin_reload: 'i',
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
    const alertInput = $('#abc');
    if (alertInput) alertInput.value = '';
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
  const open = (state.alerts.incidents || []).filter((i) => i.status !== 'resolved').length;
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
    const openIncidents = (state.alerts.incidents || []).filter((i) => i.status !== 'resolved');
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
  applyDisplayPreferences();
  $('#themeMoon').addEventListener('click', () => {
    setThemePreference('dark');
    const select = $('#st-theme');
    if (select) select.value = 'dark';
  });
  $('#themeSun').addEventListener('click', () => {
    setThemePreference('light');
    const select = $('#st-theme');
    if (select) select.value = 'light';
  });
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
    if (btn) handleAction(btn.dataset.act, btn);
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

function handleAction(action, el = null) {
  if (action === 'refresh') refreshAll(true);
  if (action === 'health') healthReport();
  if (action === 'export-metrics') {
    const source = el?.dataset?.rangeSource ? document.getElementById(el.dataset.rangeSource) : null;
    exportMetrics(source?.value || el?.dataset?.range);
  }
  if (action === 'export-events') exportEvents();
  if (action === 'new-rule') openRuleForm(null);
  if (action === 'copy-address') copyAddress();
  if (action === 'save-settings') saveSettings();
  if (action === 'reset-settings') resetSettings();
  if (action === 'export-settings') exportSettings();
  if (action === 'import-settings') importSettings();
  if (action === 'run-retention') runRetentionNow();
  if (action === 'create-credential') createAgentCredential();
  if (action === 'reload-security') loadSettingsSecurity(true);
  if (action === 'discord-test') testDiscordChannel();
  if (action === 'open-alert-rules') {
    ui.alerts.tab = 'rules';
    go('alerts');
  }
  if (action === 'open-alert-channels') {
    ui.alerts.tab = 'chan';
    go('alerts');
  }
  if (action === 'open-alert-incidents') {
    ui.alerts.tab = 'inc';
    go('alerts');
  }
}

function copyAddress() {
  const address = serverAddress();
  if (!address) {
    toast('No server address configured');
    return;
  }
  copyText(address, 'Address copied');
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

async function exportMetrics(range = null) {
  const selected = range || $('#st-export-range')?.value || ui.range;
  try {
    await apiDownload(`/api/v1/export/metrics?range=${selected}`, `minepulse-metrics-${selected}.csv`);
    toast('Metrics export downloaded');
  } catch (error) {
    reportError(error);
  }
}

async function exportEvents() {
  try {
    const EVENT_LEVEL_SEVERITY = { info: 'info', warn: 'warning', error: 'critical' };
    const query = buildQuery({
      severity: EVENT_LEVEL_SEVERITY[ui.events.lv],
      search: ui.events.q || undefined,
    });
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
    if (!display.live) return;
    scheduleRerender();
  });
  socket.on(SOCKET.metrics, (metrics) => {
    state.metrics = metrics;
    if (!display.live) return;
    if (ui.page === 'overview' || ui.page === 'performance') scheduleRerender();
    else if (ui.page === 'alerts') refreshAlertLive();
    else renderChrome();
  });
  socket.on(SOCKET.players, (payload) => {
    state.playersOnline = payload?.online || [];
    if (!display.live) return;
    if (ui.page === 'overview') scheduleRerender();
    else if (ui.page === 'players') {
      Promise.all([loadPlayersAll(), loadPlayersAnalytics()])
        .then(() => drawPlayersPage())
        .catch(() => {});
    } else renderChrome();
  });
  socket.on(SOCKET.plugins, (snapshot) => {
    state.plugins = snapshot;
    if (!display.live) return;
    if (ui.page === 'overview' || ui.page === 'plugins') scheduleRerender();
  });
  socket.on(SOCKET.event, (event) => {
    state.eventsRecent = [event, ...state.eventsRecent].slice(0, 40);
    if (!state.eventsBuf.some((e) => e.id === event.id)) {
      state.eventsBuf.unshift(event);
      if (state.eventsBuf.length > EVENT_BUFFER) state.eventsBuf.length = EVENT_BUFFER;
    }
    if (!display.live) return;
    if (ui.page === 'overview') {
      scheduleRerender();
      return;
    }
    // The events page patches its table in place so the search box keeps focus.
    // The buffer still fills while the tail is paused; resuming redraws it.
    if (ui.page === 'events' && ui.events.live) drawEvents();
  });
  socket.on(SOCKET.action, (action) => {
    if (!action) return;
    const terminal = action.status === 'done' || action.status === 'failed';
    if (action.action === 'broadcast') {
      loadBroadcasts()
        .then(() => {
          if (ui.page === 'alerts') drawAlertSidebar();
        })
        .catch(() => {});
    }
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
    if (terminal && String(action.action || '').startsWith('plugin_')) {
      // A successful plugin action triggers a fresh inventory from the agent
      // (handled by SOCKET.plugins). On failure, re-read so the switch reverts.
      if (action.status === 'failed') {
        loadPlugins()
          .then(() => {
            if (ui.page === 'plugins') drawPlugins();
            refreshOpenPluginModal();
          })
          .catch(() => {});
      }
    }
  });
  socket.on(SOCKET.alertTriggered, (payload) => {
    toast(`Alert triggered: ${payload?.rule?.name || 'rule'}`);
    loadAlerts()
      .then(() => {
        updateBadges();
        if (ui.page === 'alerts') drawAlerts();
        else scheduleRerender();
      })
      .catch(() => {});
  });
  socket.on(SOCKET.alertResolved, (payload) => {
    toast(`Alert resolved: ${payload?.rule?.name || 'rule'}`);
    loadAlerts()
      .then(() => {
        updateBadges();
        if (ui.page === 'alerts') drawAlerts();
        else scheduleRerender();
      })
      .catch(() => {});
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
  state.security = null;
  ui.settings.securityError = null;
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
    openStartPage();
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
    openStartPage();
  } catch {
    showLogin();
  }
}

boot();
