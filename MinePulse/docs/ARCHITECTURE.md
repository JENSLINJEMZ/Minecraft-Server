# Architecture

MinePulse has three cooperating pieces plus a database:

```
 Paper server (plugins/MinePulseAgent-*.jar)
        │  HTTPS/HTTP POST (agent token)          ┌───────────────┐
        ▼                                          │   SQLite      │
 MinePulse API (Express, :4000)  ─── Prisma ──────▶│  (Prisma)     │
        │  Socket.IO (session cookie)              └───────────────┘
        ▼
 MinePulse Dashboard (React, :5173)
```

## Components

### 1. `apps/plugin` — MinePulseAgent (Java)

A Paper plugin that samples the server and pushes telemetry to the API. It never
executes commands and never reads chat.

- Collects on the **main thread** (TPS, MSPT, heap, players, plugins, events) and
  sends over `java.net.http.HttpClient` with `sendAsync` so the server tick is
  never blocked by I/O.
- Authenticates with a **bearer agent token** (`x-agent-token`), separate from
  dashboard sessions. Tokens are stored server-side as SHA-256 hashes.
- Discovers its `serverId` from `GET /api/v1/agent/context` and caches it in
  `config.yml`.
- Buffers outbound payloads (bounded) and retries on failure.

Cadence defaults: heartbeat 15s, metrics 10s, plugins 300s, events 5s.

### 2. `apps/api` — API (Node/TypeScript)

- **Express** with Zod validation on every request body/query.
- **Prisma + SQLite** for persistence.
- **Socket.IO** for realtime fan-out to the dashboard.
- **Session auth** for the dashboard (DB-backed sessions, signed cookie +
  double-submit CSRF for mutations).
- **Agent auth** via hashed bearer tokens.
- Background **jobs** for alert evaluation, metric aggregation and retention.

### 3. `apps/dashboard` — Dashboard (React)

- Vite + React + TypeScript + Tailwind + Recharts + TanStack Query.
- Talks to the API over REST and Socket.IO; every page reflects live data.
- Real-time events are pushed straight into the React Query cache.

### 4. `packages/shared`

Zod schemas, TypeScript types and constants that define the agent↔API and
API↔dashboard contracts. Both apps and the plugin's payload shapes are kept in
sync here.

## Data flow

1. The agent POSTs a **heartbeat**, **metrics**, **events** or **plugins**
   payload to `/api/v1/agent/*`.
2. The API persists it, updates derived state (status, player sessions, plugin
   inventory) and **publishes** to the Socket.IO bus.
3. Connected dashboards receive `server:status`, `server:metrics`,
   `server:players`, `server:plugins` or `server:event` and update the cache.
4. An evaluator job periodically resolves alert rules against the newest
   telemetry with **hysteresis** (see below) and opens/resolves incidents,
   emitting `alert:triggered` / `alert:resolved`.
5. An aggregation job rolls raw samples into 1-minute then 1-hour buckets; a
   retention job prunes data past the configured windows.

## Realtime events

| Event              | Payload             |
| ------------------ | ------------------- |
| `server:status`    | `ServerStatus`      |
| `server:metrics`   | `CurrentMetrics`    |
| `server:players`   | online roster       |
| `server:plugins`   | `PluginSnapshot`    |
| `server:event`     | `ServerEvent`       |
| `alert:triggered`  | `{ rule, incident }`|
| `alert:resolved`   | `{ rule, incident }`|

## Status model

| State      | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `online`   | Fresh heartbeat and fresh telemetry.                           |
| `degraded` | Reporting, but a key metric is unhealthy (e.g. low TPS).        |
| `stale`    | Heartbeat older than `heartbeatStaleSeconds` (agent may be silent). |
| `offline`  | Heartbeat older than `heartbeatOfflineSeconds`.                |

The distinction between *server offline* and *agent stopped reporting* is
surfaced on the status card and used by alert rule metrics
(`heartbeat_missing` vs `agent_disconnected`).

## Alerting model

- A rule has a metric, operator, threshold, evaluation window, severity and
  cooldown.
- Rules are evaluated every 10 seconds.
- **Hysteresis:** two consecutive breaching samples open an incident; two
  consecutive healthy samples resolve it. This prevents flapping.
- A per-rule **cooldown** suppresses new incidents too soon after the last one.
- Notifications go to a **backend-only** Discord webhook. If no webhook is
  configured, deliveries are recorded with status `skipped` and the UI clearly
  reports "not configured".

## Background jobs

| Job         | Cadence | Purpose                                             |
| ----------- | ------- | --------------------------------------------------- |
| Alerts      | 10s     | Evaluate rules, open/resolve incidents, notify.     |
| Aggregation | 60s     | Roll raw → 1m → 1h metrics (idempotent upserts).     |
| Retention   | 6h      | Prune data past configured retention windows.       |

All jobs are idempotent and safe to re-run after a restart. Timers are
`unref()`ed and cleared on shutdown.

## Database models (Prisma)

`User`, `Session`, `Server`, `AgentCredential`, `ServerHeartbeat`,
`MetricSample`, `MetricAggregate1m`, `MetricAggregate1h`, `Player`,
`PlayerSession`, `PluginSnapshot`, `PluginRecord`, `ServerEvent`, `AlertRule`,
`AlertIncident`, `NotificationDelivery`, `AuditLog`, `ServerSettings`.

Dedupe is enforced with unique keys such as `(serverId, requestId)` on heartbeats
and metrics, and `(serverId, inventoryHash)` on plugin snapshots, so retries are
safe.
