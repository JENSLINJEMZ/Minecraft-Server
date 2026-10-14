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
  cpuUsagePercent: 18,
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
    { pluginName: 'EssentialsX', version: '2.20.1', enabled: true, apiVersion: '1.21' },
    { pluginName: 'WorldEdit', version: '7.3.10', enabled: false, apiVersion: null },
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
  })),
};

const activity = {
  serverId: 'srv1',
  points: [
    { day: '2026-01-01', uniquePlayers: 12, sessions: 30, peakConcurrent: 6 },
    { day: '2026-01-02', uniquePlayers: 9, sessions: 21, peakConcurrent: 5 },
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

const alerts = { rules, incidents, discordConfigured: false };

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
  if (path.startsWith('/api/v1/server/players/') && path.includes('/sessions')) return playersPage;
  if (path.startsWith('/api/v1/server/players/')) return playerOnline;
  if (path.startsWith('/api/v1/server/players')) return playersPage;
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
    expect(document.querySelector('#pk').children.length).toBe(4);
    expect(document.querySelector('#pf').children.length).toBe(5);

    await go('players');
    await vi.waitFor(() => {
      expect(document.querySelector('#ptab').textContent).toContain('Steve');
    });
    expect(document.querySelector('#ppager').textContent).toContain('of 2');

    await go('plugins');
    expect(document.querySelector('#gtab').textContent).toContain('EssentialsX');
    expect(document.querySelector('#gk').children.length).toBe(4);

    await go('events');
    await vi.waitFor(() => {
      expect(document.querySelector('#etab').textContent).toContain('Player joined');
    });

    await go('alerts');
    expect(document.querySelector('#rtab').textContent).toContain('TPS Low');
    expect(document.querySelector('#itab').textContent).toContain('open');
    expect(document.querySelector('#itab').textContent).toContain('15.2');

    await go('settings');
    expect(document.querySelector('#st-raw')).toBeTruthy();
    expect(document.querySelector('#views').textContent).toContain('Not configured');
  });

  it('opens a player detail modal', async () => {
    await go('players');
    await vi.waitFor(() => {
      expect(document.querySelector('#ptab tr[data-uuid]')).toBeTruthy();
    });
    document.querySelector('#ptab tr[data-uuid]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#md .mc2')?.textContent).toContain('Steve');
    });
    expect(document.querySelector('#md .mc2').textContent).toContain('Recent sessions');
  });

  it('creates an alert rule through the modal', async () => {
    await go('alerts');
    document.querySelector('[data-act="new-rule"]').click();
    await vi.waitFor(() => {
      expect(document.querySelector('#rf-name')).toBeTruthy();
    });
    document.querySelector('#rf-name').value = 'CPU High';
    document.querySelector('#rf-save').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('toggles, tests and deletes an alert rule', async () => {
    await go('alerts');
    document.querySelector('.sw[data-op="toggle"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts/r1'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    document.querySelector('[data-op="test"]').click();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/alerts/r1/test'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    document.querySelector('[data-op="delete"]').click();
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
