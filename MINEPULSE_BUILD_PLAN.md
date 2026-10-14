# MinePulse — Build Plan

Source prompt: `dashboard.txt` (MinePulse — Premium Minecraft Server Monitoring Platform)

This is the working plan. It expands the spec's Phase 1–5 into ordered, checkable
phases (Phase 0–9), locks in environment decisions, and lists the open questions
that need answering before/while building.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## 0. Environment (verified on this machine)

| Tool | Status | Notes |
|---|---|---|
| Node.js | ✅ v24.14.0 | Frontend + backend |
| npm | ✅ 11.9.0 | Chosen package manager (no pnpm/yarn present) |
| git | ✅ 2.53.0 | Monorepo VCS |
| Java | ✅ 25.0.1 (runtime) + JDK 21 (`JAVA_HOME`) | Plugin compiled with `--release 21` |
| Maven / Gradle | ❌ not installed | **Phase 0 will add Maven** (wrapper or local binary) for `MinePulseAgent` |
| Paper server | ✅ Paper 26.3-166 (`D:\JEMZ\Minecraft_Server`) | Real target for the agent |

**Constraints / decisions**
- Package manager: **npm** (with npm workspaces for the monorepo).
- Plugin build: **Maven**, invoked via wrapper (`mvnw`) or a locally installed Maven
  so no global install is required. Fallback documented: `javac` build script
  (we already used this pattern for EmQuestList).
- Database: **SQLite** via Prisma for v1, behind a repository layer so Postgres
  can be swapped in later.
- Default bind: **localhost** in dev; remote access requires explicit secure config.
- Target Minecraft/Paper: **Paper 26.3 build 166** (paper-api `26.3.build.166-beta`),
  Java 21 bytecode. Documented as the tested version; no promise for other versions.

---

## 1. Target architecture (monorepo)

```
MinePulse/
  apps/
    dashboard/        React + Vite + TS + Tailwind + Recharts + TanStack Query + Socket.IO client
    api/              Express + TS + Zod + Prisma(SQLite) + Socket.IO server
  packages/
    shared/           Zod schemas, shared TS types, constants (single source of truth)
  minecraft-plugin/   Java Paper plugin "MinePulseAgent" (Maven)
  docs/               ARCHITECTURE.md API.md INSTALLATION.md SECURITY.md TROUBLESHOOTING.md
  scripts/            bootstrap-admin, dev, build, seed helpers
  .env.example  .gitignore  package.json  README.md
```

Boundaries: UI never talks to the DB; API is the only writer; agent authenticates
on a **separate** credential channel from dashboard users.

---

## 2. Phases

### Phase 0 — Prerequisites & decisions  `[x]`
- Answer the open questions (Section 4).
- Confirm/create monorepo location.
- Install Maven locally (download Apache Maven 3.9.x into a tools dir, or vendor the
  Maven wrapper) so `minecraft-plugin` builds reproducibly.
- Verify registry/network access with a throwaway `npm ping`.

**Deliverable:** tooling ready; `minepulse/` directory created.
**Verify:** `node -v`, `npm -v`, `mvn -v` all respond.

### Phase 1 — Monorepo foundation  `[x]`
- npm workspaces (`apps/*`, `packages/*`), root scripts.
- TypeScript base configs, ESLint + Prettier, shared tsconfig.
- `packages/shared`: Zod schemas + types + constants (metric names, event types,
  severities, schema version, socket event names).
- `.env.example` (placeholders only), `.gitignore` (no `.env`, no `node_modules`,
  no build output, no `*.db`), `README.md`, `docs/` skeletons.

**Deliverable:** `npm install` succeeds, `npm run typecheck` passes on the empty workspace.
**Verify:** workspace builds; shared package importable from both apps.

### Phase 2 — Database & domain layer  `[x]`
- Prisma schema implementing **every model** in spec §14 (User, Server,
  AgentCredential, ServerHeartbeat, MetricSample, Player, PlayerSession,
  PluginSnapshot, PluginRecord, ServerEvent, AlertRule, AlertIncident,
  NotificationDelivery, AuditLog).
- FKs, composite unique constraints (server+requestId — the agent's `sequence`
  restarts each session so it must not be globally unique), time-series indexes
  (serverId, recordedAt), migrations.
- Repository/service layer (no Prisma calls leaking into routes).
- Seed: single Server row + admin bootstrap path.

**Deliverable:** `npx prisma migrate dev` creates SQLite DB; `prisma studio` shows tables.
**Verify:** migration runs clean; repositories unit-tested.

### Phase 3 — API core + auth  `[x]`
- Express app: config loader (env validation via Zod), structured logging,
  centralized error handler, request IDs, security headers, strict CORS allowlist,
  rate limiting (login + ingestion), body-size limits.
- Auth: **Argon2id** password hashing, HTTP-only + SameSite session cookies,
  CSRF protection, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- Authorization guard for all `/api/v1` protected routes.
- **Bootstrap admin** via script/CLI (no public registration endpoint).
- Audit log writes for admin actions.

**Deliverable:** can log in/out via API; protected route rejects anonymous requests.
**Verify:** Supertest: login success/failure, session cookie, CSRF, unauthorized 401/403.

### Phase 4 — Dashboard shell + design system  `[x]`
- Vite + React + TS + Tailwind; design tokens from spec §3 (colors, spacing,
  typography, radii, states).
- Reusable UI: Card, Button, Dialog, Form fields, Table, Toast, Badge, Skeleton.
- Layout: persistent sidebar (Overview, Performance, Players, Plugins, Events & Logs,
  Alerts, Settings), branding, connection indicator, server name, collapse control,
  profile/logout menu, mobile drawer, breadcrumbs, page titles.
- Loading / empty / offline / error states as first-class components.
- Login page + protected routing; TanStack Query provider; Socket provider (stub).

**Deliverable:** login flow works against the API; shell responsive on desktop/tablet/mobile.
**Verify:** manual + component tests for auth guard and states.

### Phase 5 — Paper plugin `MinePulseAgent`  `[x]`
- Maven project, `paper-plugin.yml`/`plugin.yml`, shaded build → JAR.
- `config.yml` exactly per spec §11 (backend-url, server-id, agent-token,
  intervals, timeouts, debug).
- Config layer with validation + secret redaction in logs.
- Collectors: TPS (1/5/15m), MSPT (bounded rolling calc, documented), JVM heap
  (used/max/committed), uptime, player count/max, plugin inventory.
- Listeners: `PlayerJoinEvent` / `PlayerQuitEvent` → structured events + sessions.
- Telemetry client: async HTTPS (never blocks main thread), exponential backoff +
  jitter, bounded queue, connection state, clean shutdown.
- Payloads carry serverId, timestamp, requestId/sequence, schemaVersion.
- Unit tests (JUnit) for config parsing, MSPT calc, payload serialization.

**Deliverable:** `mvn package` produces a JAR that loads on Paper 26.3.
**Verify:** plugin enables on the real server; logs show registration/heartbeat attempts.

> **Build note (verified 2026-10-14):** Paper 26.3 ships Java 25 bytecode (class
> file 69.0), so the plugin must be compiled with a **JDK 25** toolchain
> (`maven.compiler.release=25`). Use `npm run build:plugin` / `npm run
> deploy:plugin` — the scripts auto-locate a JDK 25 and drive the bundled Maven.
> The jar must be placed directly in `plugins/` (not in a sub-folder), with its
> config at `plugins/MinePulseAgent/config.yml`.
>
> **Live result:** heartbeat, metrics (TPS/MSPT/heap/CPU), events and the 20-plugin
> inventory all ingested and shown as `online` in the dashboard.

### Phase 6 — Ingestion pipeline  `[x]`
- Agent-auth middleware: token **hash** verification, per-server authorization,
  rotation + revocation, agent auth distinct from user sessions.
- Routes: `POST /agent/heartbeat`, `/agent/metrics`, `/agent/events`, `/agent/plugins`.
- Zod validation of every payload; reject future-dated/duplicate/delayed telemetry;
  replay-resistant request IDs; payload-size + rate limits; bounded ingestion queue.
- Persist heartbeats, metric samples, events, plugin snapshots/records.
- Server-side status derivation (online/offline/stale/degraded) from heartbeat timeout.

**Deliverable:** real telemetry from the Paper plugin lands in SQLite.
**Verify:** integration test (hash auth, dedupe, storage) + live end-to-end on the server.

### Phase 7 — Live monitoring UI  `[x]`
- Socket.IO server: authenticated handshake, server-room authorization, events
  `server:status|metrics|players|plugins|event`, `alert:triggered|resolved`.
  Persist-before-broadcast; reconnect + resync; no secret leakage; no duplicate events.
- API read routes: `/server`, `/server/status`, `/server/metrics/current`,
  `/server/metrics/history?range=`, `/server/events`, `/server/plugins`,
  `/server/players`, `/server/players/:uuid/sessions` (pagination/filtering).
- **Overview**: header (state, version, address+copy, last telemetry, refresh),
  metric cards (players/max, TPS, MSPT, heap, CPU *only if reliable*, uptime,
  last restart, agent connectivity), charts (TPS/MSPT/memory/players) with
  15m/1h/6h/24h/7d ranges, recent events, active alerts, join/leave feed,
  plugin health, data freshness.
- **Performance**: 1/5/15m TPS, current/rolling MSPT, heap used/max/committed,
  GC if measurable, CPU when reliable, uptime, restart/incident timeline,
  explicit "missing metric" explanations.
- **Players**: online list, UUID/username, first/last seen, session start,
  session history, daily/weekly activity, peak concurrent, search/pagination/date filters.
- **Plugins**: name, version, enabled, api-compat, last update, search/filter, history.
- **Events & Logs**: categories per §9, search, severity/category/date filters,
  pagination, expandable details, copy event ID, CSV export.
- HTTP fallback when sockets are down.

**Deliverable:** the dashboard shows live data from the real server; charts read history.
**Verify:** disconnect the agent → status flips to stale/offline after timeout; history queries work.

### Phase 8 — Alerting + Discord  `[x]`
- `AlertRule` CRUD (`GET/POST/PATCH/DELETE /alerts`, `POST /alerts/:id/test`).
- Evaluator job: consecutive-sample/hysteresis to prevent flapping; supports the
  rule metrics in §10; heartbeat-missing detection with configurable timeout that
  distinguishes *server offline* vs *agent stopped reporting*.
- Incidents (`AlertIncident`) + delivery tracking (`NotificationDelivery`),
  cooldown, recovery notifications, bounded retry on failure.
- Discord webhook via **backend-only** secret; never returned to frontend or logged.
- Alerts UI page wired to realtime `alert:triggered|resolved`.

**Deliverable:** an alert triggers and resolves from real collected metrics; test
notification works when a webhook is configured (and clearly reports when not configured).
**Verify:** automated evaluator tests + one live trigger/recover cycle.

> **Verified 2026-10-14 (live):** rule created → `alert:triggered` over Socket.IO →
> incident opened with the real TPS value → `alert:resolved` after the condition
> cleared → delete cascades incidents. With no webhook the delivery status is
> `skipped` and the UI/test endpoint honestly report "not configured". Pointing
> `DISCORD_WEBHOOK_URL` at a local mock captured the actual Discord embed and
> produced a `delivered` status plus an `alert_delivered` event.
> 18 unit tests pass (8 API + 10 dashboard).

### Phase 9 — Hardening, jobs, docs  `[x]`
- Retention + aggregation jobs (raw 7d, 1m 30d, 1h 180d, events 30d, configurable;
  player-session policy), idempotent + retry-safe.
- `GET /export/metrics`, `GET /export/events` (CSV, authorized).
- `GET/PATCH /settings` (admin only) with audit logging.
- Full test pass: Vitest (FE+BE), Supertest (API), JUnit (plugin),
  integration (auth, ingestion, persistence, realtime, alerts).
- Failure-mode tests: disconnects, restarts, malformed telemetry, reconnection,
  unavailable vs healthy data.
- Docs: ARCHITECTURE, API, INSTALLATION, SECURITY, TROUBLESHOOTING; exact dev/prod
  commands; how to install the JAR; how to create/rotate an agent credential.
- Security review: secrets in env, no stack traces in prod, redaction, CORS/CSRF/rate limits.

**Deliverable:** meets the spec §19 acceptance criteria; documented end-to-end.
**Verify:** full test suite green; acceptance checklist signed off.

> **Verified 2026-10-14 (live):**
> - Aggregation job populated `MetricAggregate1m`; `/server/metrics/history?range=6h`
>   returns 60s buckets built from the rollups.
> - `GET /export/metrics?range=15m` and `GET /export/events` return real CSV with
>   the expected headers (85 metric rows / 21 event rows at the time).
> - `PATCH /settings` changed `retentionEventsDays`, wrote an audit row and a
>   `setting_changed` event, and the change was reverted cleanly.
> - Settings page added (nav + route) with retention/threshold editing, a
>   read-only Discord status and CSV export buttons; Events page export now uses
>   the server-side, filter-aware endpoint.
> - Tests: 38 passing — API 28 (9 jobs, 8 alerts, 11 HTTP surface incl. Supertest
>   401/404 checks), dashboard 10. `npm run typecheck` and `npm run build` green.
> - Docs written: `docs/ARCHITECTURE.md`, `API.md`, `INSTALLATION.md`,
>   `SECURITY.md`, `TROUBLESHOOTING.md`.
> - `npm audit`: the only browser-shipped finding (`react-router-dom < 7.18`) was
>   fixed by upgrading to 7.18.4; the remaining 16 advisories are dev/build
>   tooling only (`npm audit fix` is a no-op, fixes require Tailwind v4 / Vitest v5).

---

## 3. Acceptance-criteria mapping (spec §19)

| # | Criterion | Phase |
|---|---|---|
| 1 | Dashboard builds/starts with documented commands | 1,4,7,9 |
| 2 | API + DB initialize | 2,3 |
| 3 | Admin login/logout secure | 3,4 |
| 4 | Plugin compiles to JAR | 5 |
| 5 | Plugin authenticates + sends telemetry | 5,6 |
| 6 | Real metrics in dashboard | 6,7 |
| 7 | Agent disconnect flips status after timeout | 6,7 |
| 8 | Historical charts query persisted data | 2,7 |
| 9 | Sessions + plugin snapshots stored | 5,6 |
| 10 | Alert triggers/resolves from real metrics | 8 |
| 11 | Discord test when configured | 8 |
| 12 | Unauthorized API/WebSocket rejected | 3,7 |
| 13 | Distinguish unavailable vs healthy | 4,7 |
| 14 | Retention removes eligible data safely | 9 |
| 15 | Tests cover auth/ingestion/persistence/alerts/UI | 3,5,6,8,9 |
| 16 | No feature depends on hardcoded demo data | all |
| 17 | Docs explain configure/install/secure/test/troubleshoot | 9 |

---

## 4. Open questions (need answers before Phase 0/1)

1. **Repo location** — default proposed: `D:\JEMZ\MinePulse` (sibling of the server,
   keeps the Paper dir clean). Alternative: inside `D:\JEMZ\Minecraft_Server\MinePulse`.
2. **Delivery depth** — build all phases now (long), or land a working end-to-end
   vertical slice first (Phases 0–7) and then do alerts/hardening (8–9)?
3. **Dashboard access** — localhost only, or reachable by you/remotely (affects
   HTTPS/CORS/bind and whether we need a reverse proxy)?
4. **Discord webhook** — do you have one to wire up now, or leave alert delivery
   "not configured" until later?
5. **Bootstrap admin** — give me the admin **email** to create; I'll generate a
   strong password and show it once (or you pick one).
6. **Ports** — API `4000`, dashboard dev `5173`. OK, or different?
7. **CPU metric** — expose it only when a reliable source exists (spec). OK to show
   it as "unavailable" unless we add a host agent later?

---

## 5. Commands reference (to be finalized per phase)

```
# install
npm install
# configure
cp .env.example .env     # then set SESSION_SECRET
# db
npm run db:migrate -w @minepulse/api
npm run bootstrap-admin -w @minepulse/api -- --email you@example.com
# dev
npm run dev            # api (:4000) + dashboard (:5173)
# build
npm run build          # all workspaces
# test
npm run test           # vitest (+ supertest HTTP surface)
# plugin (JDK 25; local Maven under tools/)
npm run build:plugin
npm run deploy:plugin -- -Token mp_xxx
```

---

## 6. Risks / notes

- No Maven/Gradle preinstalled → Phase 0 adds Maven (wrapper or local binary).
- Paper 26.3 is recent; TPS/MSPT APIs may differ → collector uses bounded rolling
  calculations and documents exactly what is measured.
- Host-wide CPU/disk/network are **not** measurable from the Paper plugin alone →
  shown as "unavailable" unless a host agent is added (out of scope for v1).
- Everything is verified with real runs; nothing is claimed working unless observed.
