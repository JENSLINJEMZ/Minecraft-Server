// @vitest-environment jsdom
/**
 * End-to-end smoke test for the vanilla dashboard runtime.
 *
 * It boots the real `src/main.js` against a canned API, then walks every nav
 * page. This catches template/runtime errors (bad field names, missing DOM
 * ids, thrown render functions) without needing a browser.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, '../index.html'), 'utf8');

const { socketHandlers } = vi.hoisted(() => {
  const handlers = {};
  const socket = {
    on(event, fn) {
      handlers[event] = fn;
      return socket;
    },
    disconnect() {},
  };
  return { socketHandlers: handlers };
});

vi.mock('socket.io-client', () => ({
  io: () => ({
    on(event, fn) {
      socketHandlers[event] = fn;
      return this;
    },
    disconnect() {},
  }),
}));

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const serverInfo = {
  id: 'srv1',
  name: 'Smoke Server',
  minecraftVersion: '1.21.4',
  software: 'Paper',
  address: 'localhost:25565',
  createdAt: iso(60 * 24 * 30),
  updatedAt: iso(1),
};

const status = {
  serverId: 'srv1',
  state: 'online',
  agentConnected: true,
  minecraftVersion: '1.21.4',
  software: 'Paper',
  address: 'localhost:25565',
  playerCount: 3,
  maxPlayers: 20,
  uptimeSeconds: 3600,
  lastHeartbeatAt: iso(0.2),
  lastTelemetryAt: iso(0.3),
  dataFreshnessSeconds: 18,
  reason: null,
};

const sample = {
  recordedAt: iso(0.3),
  tps1m: 19.8,
  tps5m: 19.7,
  tps15m: 19.6,
  mspt: 42.3,
  heapUsedBytes: 1_300_000_000,
  heapMaxBytes: 4_294_967_296,
  heapCommittedBytes: 2_000_000_000,
  heapOldBytes: 900_000_000,
  heapYoungBytes: 350_000_000,
  cpuUsagePercent: 18,
  threadCount: 84,
  entityCount: 1_820,
  chunkCount: 3_012,
  netRxBytes: 10_145_000,
  netTxBytes: 2_043_500,
  gc: [
    { name: 'G1 Young Generation', count: 42, totalMs: 512, lastMs: 12 },
    { name: 'G1 Old Generation', count: 4, totalMs: 88, lastMs: 21 },
  ],
  tickBreakdown: [
    { name: 'World ticking', samples: 320 },
    { name: 'Entities', samples: 180 },
    { name: 'Chunk loading', samples: 120 },
    { name: 'Network', samples: 80 },
    { name: 'Plugins', samples: 60 },
    { name: 'Idle', samples: 220 },
    { name: 'Other', samples: 20 },
  ],
  pluginTickCost: [
    { name: 'EssentialsX', samples: 40 },
    { name: 'WorldEdit', samples: 12 },
  ],
};

const currentMetrics = {
  serverId: 'srv1',
  sample,
  heapUsedPercent: 30.2,
  playerCount: 3,
  maxPlayers: 20,
  uptimeSeconds: 3600,
  agentVersion: '1.0.0',
  lastHeartbeatAt: iso(0.2),
};

const plugins = {
  id: 'snap1',
  serverId: 'srv1',
  collectedAt: iso(2),
  pluginCount: 2,
  inventoryHash: 'abcdef1234567890',
  plugins: [
    {
      pluginName: 'EssentialsX',
      version: '2.20.1',
      enabled: true,
      staged: null,
      apiVersion: '1.21',
      author: 'EssentialsX Team',
      commandCount: 12,
    },
    {
      pluginName: 'WorldEdit',
      version: '7.3.10',
      enabled: false,
      staged: null,
      apiVersion: null,
      author: 'EngineHub',
      commandCount: null,
    },
  ],
};

const events = [
  {
    id: 'e1',
    serverId: 'srv1',
    eventType: 'player_joined',
    severity: 'info',
    occurredAt: iso(2),
    receivedAt: iso(2),
    summary: 'Player joined: Steve',
    details: { player: 'Steve' },
    requestId: null,
  },
  {
    id: 'e2',
    serverId: 'srv1',
    eventType: 'performance_warning',
    severity: 'warning',
    occurredAt: iso(9),
    receivedAt: iso(9),
    summary: 'MSPT above budget',
    details: null,
    requestId: 'req1',
  },
];

const playerOnline = {
  uuid: '11111111-1111-4111-8111-111111111111',
  lastKnownUsername: 'Steve',
  firstSeenAt: iso(60 * 24 * 10),
  lastSeenAt: iso(0.5),
  online: true,
  currentSessionStartedAt: iso(120),
  totalPlaytimeSeconds: 42_000,
  sessionCount: 12,
  world: 'world',
  pingMs: 42,
  gamemode: 'survival',
  operator: true,
  position: { x: 12.5, y: 64, z: -30.2 },
  health: 20,
  foodLevel: 18,
  xpLevel: 30,
  mobKills: 210,
  deaths: 7,
  blocksMined: 15_400,
  clientBrand: 'vanilla',
  muted: false,
  banned: false,
  banReason: null,
  banExpiresAt: null,
  banSource: null,
  notes: [
    {
      id: 'n1',
      playerUuid: '11111111-1111-4111-8111-111111111111',
      kind: 'warning',
      body: 'Kept breaking spawn rules',
      author: 'admin@local.test',
      createdAt: iso(600),
    },
    {
      id: 'n2',
      playerUuid: '11111111-1111-4111-8111-111111111111',
      kind: 'note',
      body: 'Friendly and helpful in chat',
      author: 'admin@local.test',
      createdAt: iso(1200),
    },
  ],
};

const playerOffline = {
  uuid: '22222222-2222-4222-8222-222222222222',
  lastKnownUsername: 'Alex',
  firstSeenAt: iso(60 * 24 * 20),
  lastSeenAt: iso(60 * 5),
  online: false,
  currentSessionStartedAt: null,
  totalPlaytimeSeconds: 1200,
  sessionCount: 3,
};

const playersPage = {
  items: [playerOnline, playerOffline],
  page: 1,
  pageSize: 25,
  total: 2,
  totalPages: 1,
};

const sessionsPage = {
  items: [
    { id: 's1', playerUuid: playerOnline.uuid, usernameAtJoin: 'Steve', joinedAt: iso(120), leftAt: null, durationSeconds: null },
    { id: 's2', playerUuid: playerOnline.uuid, usernameAtJoin: 'Steve', joinedAt: iso(60 * 24), leftAt: iso(60 * 22), durationSeconds: 7200 },
  ],
  page: 1,
  pageSize: 12,
  total: 2,
  totalPages: 1,
};

const playerActivity14 = {
  uuid: playerOnline.uuid,
  days: Array.from({ length: 14 }, (_, i) => ({
    day: `2026-01-${String(i + 1).padStart(2, '0')}`,
    seconds: 600 * (i % 5),
  })),
};

const playerDeaths = {
  uuid: playerOnline.uuid,
  total: 7,
  causes: [
    { cause: 'FALL', count: 3 },
    { cause: 'PLAYER_KILL', count: 2 },
    { cause: 'ENTITY_ATTACK', count: 1 },
    { cause: 'LAVA', count: 1 },
  ],
};

const playerActions = {
  items: [
    {
      id: 'a1',
      action: 'warn',
      playerUuid: playerOnline.uuid,
      playerName: 'Steve',
      detail: 'Kept breaking spawn rules',
      status: 'done',
      resultMessage: null,
      requestedBy: 'admin@local.test',
      createdAt: iso(590),
      completedAt: iso(589),
    },
    {
      id: 'a2',
      action: 'broadcast',
      playerUuid: null,
      playerName: null,
      detail: 'Server restart soon',
      status: 'done',
      resultMessage: 'Broadcast to 1 player(s)',
      requestedBy: 'admin@local.test',
      createdAt: iso(600),
      completedAt: iso(599),
    },
    {
      id: 'a3',
      action: 'message',
      playerUuid: playerOnline.uuid,
      playerName: 'Steve',
      detail: 'Welcome back',
      status: 'done',
      resultMessage: 'Message delivered to Steve',
      requestedBy: 'admin@local.test',
      createdAt: iso(610),
      completedAt: iso(609),
    },
    {
      id: 'a4',
      action: 'ban',
      playerUuid: playerOnline.uuid,
      playerName: 'Steve',
      detail: 'Griefing',
      status: 'failed',
      resultMessage: 'Player is not online',
      requestedBy: 'admin@local.test',
      createdAt: iso(620),
      completedAt: iso(619),
    },
  ],
};

const history = {
  serverId: 'srv1',
  range: '15m',
  bucketSeconds: 10,
  points: Array.from({ length: 30 }, (_, i) => ({
    recordedAt: iso(29 - i * 0.5),
    tps1m: 19 + Math.sin(i / 3),
    tps5m: 19,
    tps15m: 19,
    mspt: 40 + Math.cos(i / 2) * 5,
    heapUsedBytes: 1_200_000_000 + i * 1_000_000,
    heapMaxBytes: 4_294_967_296,
    playerCount: 1 + (i % 5),
    cpuUsagePercent: 15 + (i % 7),
    netRxBytes: 10_000_000 + i * 5_000,
    netTxBytes: 2_000_000 + i * 1_500,
    gcTotalMs: 1_000 + i * 7,
  })),
};

const activity = {
  serverId: 'srv1',
  points: [
    { day: '2026-01-01', uniquePlayers: 12, sessions: 30, peakConcurrent: 6 },
    { day: '2026-01-02', uniquePlayers: 9, sessions: 21, peakConcurrent: 5 },
  ],
};

const playersAnalytics = {
  serverId: 'srv1',
  windowHours: 24,
  onlineNow: 1,
  maxPlayers: 20,
  uniquePlayers: 2,
  newPlayers: 1,
  sessions: 4,
  avgSessionSeconds: 1800,
  sessionBuckets: [
    { label: 'Under 10 min', count: 1 },
    { label: '10 to 30 min', count: 1 },
    { label: '30 to 60 min', count: 1 },
    { label: 'Over 1 hour', count: 1 },
  ],
  retention: [
    { label: 'Day 1', cohort: 2, pct: 50 },
    { label: 'Day 7', cohort: 1, pct: 0 },
    { label: 'Day 30', cohort: 0, pct: null },
  ],
};

const rules = [
  {
    id: 'r1',
    serverId: 'srv1',
    name: 'TPS Low',
    metric: 'tps',
    operator: 'lt',
    threshold: 18,
    evaluationWindowSeconds: 60,
    severity: 'warning',
    cooldownSeconds: 600,
    enabled: true,
    notifyDiscord: true,
    mutedUntil: null,
    lastTriggeredAt: null,
    lastDeliveryStatus: 'none',
    createdAt: iso(600),
    updatedAt: iso(600),
  },
];

const incidents = [
  {
    id: 'i1',
    alertRuleId: 'r1',
    startedAt: iso(30),
    resolvedAt: null,
    lastNotifiedAt: null,
    status: 'open',
    triggerValue: 15.2,
    summary: 'TPS below 18',
    ruleName: 'TPS Low',
    ruleMetric: 'tps',
    ruleSeverity: 'warning',
  },
];

const alerts = {
  rules,
  incidents,
  discordConfigured: false,
  ruleStatus: [{ ruleId: 'r1', value: 15.2, breaching: true }],
  evaluation: { intervalSeconds: 10, triggerEvaluations: 2, resolveEvaluations: 2 },
};

const settings = {
  retentionRawMetricsDays: 7,
  retentionAggregated1mDays: 30,
  retentionAggregated1hDays: 365,
  retentionEventsDays: 90,
  retentionPlayerSessionsDays: 365,
  heartbeatStaleSeconds: 30,
  heartbeatOfflineSeconds: 60,
  discordConfigured: false,
};

const jsonResponse = (body) => {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([text])),
  };
};

function route(url) {
  const path = new URL(url).pathname + new URL(url).search;
  if (path.startsWith('/api/v1/auth/me')) return { user: { id: 'u1', email: 'admin@local.test', role: 'admin' }, csrfToken: 'csrf' };
  if (path.startsWith('/api/v1/server/metrics/history')) return history;
  if (path.startsWith('/api/v1/server/metrics/current')) return currentMetrics;
  if (path.startsWith('/api/v1/server/status')) return status;
  if (path.startsWith('/api/v1/server/players/analytics')) return playersAnalytics;
  if (path.includes('/players/') && path.includes('/action'))
    return {
      ok: true,
      action: {
        id: 'queued-warn',
        action: 'warn',
        playerUuid: playerOnline.uuid,
        playerName: 'Steve',
        detail: 'spamming spawn',
        status: 'pending',
        resultMessage: null,
        requestedBy: 'admin@local.test',
        createdAt: iso(0),
        completedAt: null,
      },
      muted: false,
    };
  if (path.includes('/players/') && path.includes('/notes')) {
    return {
      id: 'n3',
      playerUuid: playerOnline.uuid,
      kind: 'note',
      body: 'Smoke note',
      author: 'admin@local.test',
      createdAt: iso(0),
    };
  }
  if (path.includes('/players/') && path.includes('/activity')) return playerActivity14;
  if (path.includes('/players/') && path.includes('/deaths')) return playerDeaths;
  if (path.startsWith('/api/v1/server/players/') && path.includes('/sessions')) return sessionsPage;
  if (path.startsWith('/api/v1/server/players/')) return playerOnline;
  if (path.startsWith('/api/v1/server/players')) return playersPage;
  if (path.startsWith('/api/v1/server/broadcast')) return { ok: true, action: null };
  if (path.startsWith('/api/v1/server/actions')) return playerActions;
  if (path.includes('/plugins/') && path.includes('/action'))
    return {
      ok: true,
      action: {
        id: 'queued-plugin',
        action: 'plugin_disable',
        playerUuid: null,
        playerName: null,
        detail: 'Disable plugin EssentialsX',
        status: 'pending',
        resultMessage: null,
        requestedBy: 'admin@local.test',
        createdAt: iso(0),
        completedAt: null,
      },
    };
  if (path.startsWith('/api/v1/server/plugins')) return plugins;
  if (path.startsWith('/api/v1/server/events/recent')) return events;
  if (path.startsWith('/api/v1/server/events')) return { items: events, page: 1, pageSize: 25, total: 2, totalPages: 1 };
  if (path.startsWith('/api/v1/server/activity')) return activity;
  if (path.startsWith('/api/v1/server')) return serverInfo;
  if (path.startsWith('/api/v1/alerts')) return alerts;
  if (path.startsWith('/api/v1/settings')) return settings;
  return {};
}

beforeAll(async () => {
  const parsed = new DOMParser().parseFromString(indexHtml, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  window.scrollTo = () => {};
  window.confirm = () => true;
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};

  // jsdom cannot honor <a download>; stop it from attempting navigation noise.
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    if (this.hasAttribute('download')) return;
    return nativeAnchorClick.call(this);
  };

  globalThis.fetch = vi.fn((url) => Promise.resolve(jsonResponse(route(String(url)))));

  await import('./main.js');
  await vi.waitFor(
    () => {
      expect(document.querySelectorAll('#stats .st').length).toBe(5);
    },
    { timeout: 5000 },
  );
});

const go = async (page) => {
  const link = document.querySelector(`#nav a[data-page="${page}"]`);
  expect(link, `nav link for ${page}`).toBeTruthy();
  link.click();
  if (page === 'overview') return;
  await vi.waitFor(
    () => {
      const views = document.querySelector('#views');
      expect(views.innerHTML.trim().length).toBeGreaterThan(50);
    },
    { timeout: 5000 },
  );
};

describe('dashboard runtime', () => {
  it('renders the overview with live data', () => {
    expect(document.querySelector('#ovName').textContent).toBe('Smoke Server');
    expect(document.querySelector('#ovAddr').textContent).toBe('localhost:25565');
    expect(document.querySelector('#adName').textContent).toBe('Admin · Owner');
    expect(document.querySelector('#stats').textContent).toContain('TPS');
    expect(document.querySelector('#pt').textContent).toContain('Steve');
    expect(document.querySelector('#pg').textContent).toContain('EssentialsX');
    expect(document.querySelector('#lg').textContent).toContain('Player joined');
    expect(document.querySelector('#alist').textContent).toContain('TPS Low');
    expect(document.querySelector('#qa').children.length).toBe(4);
    expect(document.querySelector('#healthRing b').textContent).not.toBe('—');
  });

  it('navigates to every page without throwing', async () => {
    await go('performance');
    expect(document.querySelector('#pf1').children.length).toBe(4);
    expect(document.querySelector('#pf2').children.length).toBe(2);
    expect(document.querySelector('#pf3').children.length).toBe(3);
    expect(document.querySelector('#pf4').children.length).toBe(4);
    expect(document.querySelector('#pf5').children.length).toBe(2);
    expect(document.querySelector('#pf6').children.length).toBe(3);
    expect(document.querySelector('#pr').children.length).toBe(1);

    await go('players');
    await vi.waitFor(() => {
      expect(document.querySelector('#ptab').textContent).toContain('Steve');
    });
    expect(document.querySelector('#pkp').children.length).toBe(6);
    expect(document.querySelector('#ppn').children.length).toBe(3);
    expect(document.querySelector('#ppn').textContent).toContain('Activity');
    expect(document.querySelector('#ptab').textContent).toContain('world');
    expect(document.querySelector('#ptab').textContent).toContain('42 ms');
    expect(document.querySelector('#ppager').textContent).toContain('of 1');

    await go('plugins');
    const gtab = document.querySelector('#gtab');
    expect(gtab.textContent).toContain('EssentialsX');
    expect(gtab.textContent).toContain('EssentialsX Team');
    expect(gtab.textContent).toContain('4.00%');
    expect(gtab.querySelectorAll('thead th').length).toBe(9);
    expect(document.querySelector('#gk').children.length).toBe(6);
    // Enable/disable are real, admin-gated controls; changes are staged for the
    // next start, so there is no live reload control at all.
    expect(gtab.querySelectorAll('[data-plugin-toggle]').length).toBe(2);
    expect(gtab.querySelectorAll('.sw.ro').length).toBe(0);
    expect(gtab.querySelectorAll('[data-plugin-reload]').length).toBe(0);
    expect([...document.querySelectorAll('#views .tools .bt')].every((button) => button.disabled)).toBe(true);

    // The "Disabled" filter narrows the table to the offline plugin only.
    const gfilter = document.querySelector('#gfilter');
    gfilter.value = 'disabled';
    gfilter.dispatchEvent(new window.Event('change'));
    expect(document.querySelector('#gtab').textContent).toContain('WorldEdit');
    expect(document.querySelector('#gtab').textContent).not.toContain('EssentialsX Team');

    // The plugin name opens a real detail modal that can be closed again.
    document.querySelector('#gtab [data-plugin]').click();
    expect(document.querySelector('#md').textContent).toContain('WorldEdit');
    expect(document.querySelector('#md').textContent).toContain('EngineHub');
    document.querySelector('#md [data-close-modal]').click();
    expect(document.querySelector('#md').textContent).toBe('');

    // Toggling a plugin queues a real agent action and flips the switch.
    gfilter.value = 'all';
    gfilter.dispatchEvent(new window.Event('change'));
    const toggle = document.querySelector('#gtab [data-plugin-toggle][data-enable="0"]');
    expect(toggle).toBeTruthy();
    toggle.click();
    await vi.waitFor(() => {
      expect(
        globalThis.fetch.mock.calls.some(
          (call) => String(call[0]).includes('/plugins/') && String(call[0]).includes('/action'),
        ),
      ).toBe(true);
    });
    await vi.waitFor(() => {
      const row = [...document.querySelectorAll('#gtab tbody tr')].find((tr) =>
        tr.textContent.includes('EssentialsX'),
      );
      expect(row?.querySelector('[data-plugin-toggle]')?.dataset.enable).toBe('1');
    });
    // The change is visibly pending, not live.
    await vi.waitFor(() => {
      expect(document.querySelector('#gtab').textContent).toContain('Off after restart');
    });

    await go('events');
    await vi.waitFor(() => {
      expect(document.querySelector('#eb').textContent).toContain('Player joined');
    });
    // Four columns, level tabs with live counts over the filtered window.
    expect(document.querySelectorAll('#eb thead th').length).toBe(4);
    expect(document.querySelector('#elv').textContent).toContain('All (2)');
    expect(document.querySelector('#elv').textContent).toContain('Info (1)');
    expect(document.querySelector('#elv').textContent).toContain('Warnings (1)');

    // The Console tab tails the same stream with read-only, real-data commands.
    document.querySelector('#etb [data-k="log"]').click();
    expect(document.querySelector('#cs')).toBeTruthy();
    document.querySelector('#eb [data-cmd="tps"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#cs').textContent).toContain('TPS from last 1m, 5m, 15m');
    });
    document.querySelector('#eb [data-cmd="gc"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#cs').textContent).toContain('G1 Old Generation');
    });
    // Unknown input is rejected, not sent to the server as a command.
    const cmd = document.querySelector('#cmd');
    cmd.value = 'stop';
    cmd.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector('#cs').textContent).toContain('Unknown command');
    });
    expect(
      globalThis.fetch.mock.calls.some((call) => /console|command/i.test(String(call[0]))),
    ).toBe(false);

    await go('alerts');
    expect(document.querySelector('#ab').textContent).toContain('TPS Low');
    expect(document.querySelector('#ab').textContent).toContain('15.20');
    expect(document.querySelector('#ar').textContent).toContain('Rule status');

    await go('settings');
    expect(document.querySelector('#st-raw')).toBeTruthy();
    expect(document.querySelector('#views').textContent).toContain('Not configured');
  });

  it('opens the player profile page instead of a modal', async () => {
    await go('players');
    await vi.waitFor(() => {
      expect(document.querySelector('#ptab tr[data-uuid]')).toBeTruthy();
    });
    document.querySelector('#ptab tr[data-uuid]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#pfb')?.textContent).toContain('Steve');
    });
    const panel = document.querySelector('#pfb');
    expect(panel.textContent).toContain('Session history');
    expect(panel.textContent).toContain('Deaths by cause');
    expect(panel.textContent).toContain('Staff notes');
    expect(panel.textContent).toContain('Playtime');
    // The old read-only popup is gone, and no IP address is ever collected.
    expect(panel.textContent).not.toContain('Read-only monitoring');
    expect(panel.textContent).not.toContain('IP address');
    const head = panel.querySelector('.mp-head img');
    expect(head?.getAttribute('src')).toContain('mc-heads.net/avatar/');
    // Offline-mode UUIDs resolve to a default head, so the skin is looked up by
    // the player's name, with the UUID kept as the onerror fallback.
    expect(head?.getAttribute('src')).toContain('Steve');
    expect(head?.getAttribute('data-fallback')).toContain('11111111-1111-4111-8111-111111111111');
    // Live, working controls rather than disabled placeholders.
    expect(panel.querySelector('[data-pf="kick"]')).toBeTruthy();
    expect(panel.querySelector('[data-pf="ban"]')).toBeTruthy();
    expect(panel.querySelector('[data-pf="warn"]')).toBeTruthy();
    expect(panel.querySelector('[data-pf="broadcast"]')).toBeTruthy();
    expect(panel.querySelector('#pfGm')).toBeTruthy();
    expect(panel.querySelector('[data-pf="kick"]').disabled).toBe(false);
    // The audit trail is colour-coded by verb: warn yellow, broadcast green,
    // private message blue, and failed actions always red.
    const chip = (label) =>
      [...panel.querySelectorAll('#pfActions .bx')].find((el) => el.textContent === label);
    expect(chip('warn')?.classList.contains('w')).toBe(true);
    expect(chip('broadcast')?.classList.contains('s')).toBe(true);
    expect(chip('message')?.classList.contains('i')).toBe(true);
    expect(chip('ban')?.classList.contains('c')).toBe(true);
  });

  it('queues a warning from the profile page', async () => {
    document.querySelector('#pfReason').value = 'spamming spawn';
    document.querySelector('[data-pf="warn"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/server/players/11111111-1111-4111-8111-111111111111/action'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    // Fast feedback: the queued warning appears in the audit trail immediately,
    // before the agent has executed it.
    await vi.waitFor(() => {
      expect(document.querySelector('#pfActions')?.textContent).toContain('spamming spawn');
    });
  });

  it('broadcasts from the profile page', async () => {
    document.querySelector('#pfBc').value = 'Server restart in 5 minutes';
    document.querySelector('[data-pf="broadcast"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/server/broadcast'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('reconciles deaths by cause with the lifetime death count', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/players/') && u.includes('/deaths')) {
        return Promise.resolve(
          jsonResponse({ uuid: playerOnline.uuid, total: 1, causes: [{ cause: 'FALL', count: 1 }] }),
        );
      }
      return original(url);
    });
    try {
      await go('players');
      await vi.waitFor(() => {
        expect(document.querySelector('#ptab tr[data-uuid]')).toBeTruthy();
      });
      document.querySelector('#ptab tr[data-uuid]').click();
      await vi.waitFor(() => {
        expect(document.querySelector('#pfb')?.textContent).toContain('Deaths by cause');
      });
      const panel = document.querySelector('#pfb');
      // playerOnline.deaths = 7 and only one cause is recorded, so 6 deaths
      // happened before the agent started tracking.
      expect(panel.textContent).toContain('Not tracked');
      expect(panel.textContent).toContain('6 earlier deaths');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('kicks a selected player from the players page', async () => {
    await go('players');
    await vi.waitFor(() => {
      expect(document.querySelector('#ptab input[data-select]')).toBeTruthy();
    });
    const checkbox = document.querySelector('#ptab input[data-select]');
    checkbox.click();
    document.querySelector('[data-bulk="kick"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/action'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('creates an alert rule from the rules tab', async () => {
    await go('alerts');
    document.querySelector('[data-alert-tab="rules"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#nr-add')).toBeTruthy();
    });
    const metric = document.querySelector('#nr-metric');
    metric.value = 'mspt';
    metric.dispatchEvent(new window.Event('change', { bubbles: true }));
    document.querySelector('#nr-threshold').value = '60';
    document.querySelector('#nr-add').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('acknowledges and snoozes an incident', async () => {
    await go('alerts');
    document.querySelector('[data-alert-tab="inc"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-alert-incident-action="ack"]')).toBeTruthy();
    });
    document.querySelector('[data-alert-incident-action="ack"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts/incidents/i1/acknowledge'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await go('alerts');
    document.querySelector('[data-alert-incident-action="snooze"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts/incidents/i1/snooze'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('toggles, tests and deletes an alert rule', async () => {
    await go('alerts');
    document.querySelector('[data-alert-tab="rules"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-alert-rule-toggle]')).toBeTruthy();
    });
    document.querySelector('[data-alert-rule-toggle]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts/r1'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    await go('alerts');
    document.querySelector('[data-alert-tab="rules"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-alert-rule-edit]')).toBeTruthy();
    });
    document.querySelector('[data-alert-rule-edit]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#rf-test')).toBeTruthy();
    });
    document.querySelector('#rf-test').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts/r1/test'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    document.querySelector('#rf-cancel').click();

    await go('alerts');
    document.querySelector('[data-alert-tab="rules"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-alert-rule-delete]')).toBeTruthy();
    });
    document.querySelector('[data-alert-rule-delete]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts/r1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('saves settings and downloads CSV exports', async () => {
    await go('settings');
    document.querySelector('#st-raw').value = '5';
    document.querySelector('[data-act="save-settings"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/settings'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    document.querySelector('[data-act="export-events"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/export/events'),
        expect.objectContaining({ credentials: 'include' }),
      );
    });

    document.querySelector('[data-act="export-metrics"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/export/metrics'),
        expect.anything(),
      );
    });
  });
});
