# Minecraft Server + MinePulse

A self-hosted **Paper 26.3** Minecraft server together with **MinePulse**, a
private monitoring platform that streams live telemetry from the server to a
premium dark dashboard.

This repository is the source of truth for the server's *configuration* and for
the entire MinePulse codebase. Large/regenerated data (worlds, caches, backups,
plugin jars) is intentionally **not** tracked — see
[Version control](#version-control-what-is-and-is-not-committed).

---

## 1. The Minecraft server

| Item | Value |
| --- | --- |
| Server software | Paper `26.3-166-main@cc7b98a` (MC `26.3`) |
| API version | `26.3.build.166-beta` |
| Java | **JDK 25** (set `JAVA_HOME`, or put JDK 25 on `PATH`) |
| Launch script | [`run.bat`](run.bat) |
| JVM flags | `-Xms8G -Xmx8G -jar paper.jar --nogui` |
| Auth mode | `online-mode=false` (proxied via Geyser/Floodgate) |

Start the server by running **`run.bat`**. It launches `paper.jar` with JDK 25
and an 8 GB heap.

### Plugins (`plugins/`, not committed)

| Plugin | Version |
| --- | --- |
| MinePulseAgent | 0.1.0 |
| EssentialsX | 2.22.1-dev |
| LuckPerms | 5.5.71 |
| QuickShop-Hikari | 6.3.0.3 |
| EconomyShopGUI | 7.3.2 |
| mc-PlayerShop | 1.5.1 |
| Vault | – |
| Chunky | 1.5.3 |
| HuskHomes | 4.11 |
| GSit | 3.7.0 |
| SmartSpawner | 1.8.3 |
| MoneyHeads | 1.8.1 |
| ServerBounties | 2.1.0 |
| DonutAuctionHouse | 1.6.0 |
| DuelClub | 1.1.0 |
| BetterSleeping | 4.0.2 |
| headdrop | 3.1.0 |
| SkinsRestorer | 15.12.6 |
| Geyser-Spigot | 26.3preview |
| Floodgate-Spigot | 2.2.5 |

Plugin jars and their runtime data live under `plugins/`, which is gitignored
(it holds binaries, databases and the agent token). Re-download them from their
respective sources when restoring.

---

## 2. MinePulse (the monitoring platform)

MinePulse is a monorepo under [`MinePulse/`](MinePulse/) that provides:

- **Live overview** — server state, TPS/MSPT, memory, CPU, players, uptime.
- **Performance** — TPS/MSPT/memory/CPU history across 15m–7d ranges.
- **Players** — roster, first/last seen, session history, activity.
- **Plugins** — inventory, versions, enabled state, change history.
- **Events & Logs** — searchable, filterable, expandable, CSV export.
- **Alerts** — rule CRUD, hysteresis (no flapping), incidents, cooldown,
  delivery tracking, test button. Discord delivery is backend-only.
- **Settings** — retention windows, offline thresholds, data export.
- **Real-time** — Socket.IO push so pages update without heavy polling.
- **Background jobs** — metric aggregation and retention pruning.

> Read-only monitoring for your own server. It never executes commands on the
> Minecraft server, never stores plaintext agent tokens, and does not collect
> chat messages.

### Layout

```
MinePulse/
  apps/
    dashboard/       React + Vite + TypeScript + Tailwind + Recharts + TanStack Query
    api/             Express + TypeScript + Zod + Prisma (SQLite) + Socket.IO
    plugin/          Paper plugin "MinePulseAgent" (Maven)
  packages/
    shared/          Zod schemas, shared types and constants (single source of truth)
  docs/              Architecture, API, installation, security, troubleshooting
  tools/             Locally downloaded build tools (Maven) - gitignored
```

### Architecture at a glance

1. The **MinePulseAgent** plugin collects metrics on the server's main thread
   and pushes them over HTTP (`java.net.http`) to the API (heartbeats, metrics,
   players, plugins, events).
2. The **API** authenticates the agent with SHA-256-hashed tokens (a separate
   credential channel from dashboard sessions), persists samples, evaluates
   alerts and runs aggregation/retention jobs.
3. The **dashboard** talks to the API over REST + Socket.IO; alerts fan out to
   Discord only from the backend.

### Requirements

- Node.js >= 20 (tested on v24)
- **JDK 25** to build the plugin (Paper 26.3 is Java 25 bytecode)
- Paper server (tested: Paper 26.3, build 166)

### Quick start

```bash
cd MinePulse
npm install
cp .env.example .env          # then set SESSION_SECRET

npm run db:migrate -w @minepulse/api
npm run bootstrap-admin -w @minepulse/api -- --email you@example.com

npm run dev                   # API :4000 + dashboard :5173
```

Open **`http://127.0.0.1:5173`** (use the *same* hostname for the dashboard and
API — `localhost` and `127.0.0.1` are different sites for cookies).

Then build and deploy the plugin:

```bash
npm run create-agent-credential -w @minepulse/api
npm run build:plugin
npm run deploy:plugin -- -Token mp_xxx
```

Restart Paper to load the plugin.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API + dashboard in watch mode. |
| `npm run build` | Build shared + API + dashboard. |
| `npm run typecheck` | Type-check every workspace. |
| `npm test` | Run unit tests. |
| `npm run build:plugin` | Build the Paper plugin (JDK 25). |
| `npm run deploy:plugin -- -Token mp_` | Build + deploy the plugin into Paper. |

### Ports & storage

| Service | Address |
| --- | --- |
| API | `http://127.0.0.1:4000` |
| Dashboard (dev) | `http://127.0.0.1:5173` |
| SQLite DB | `MinePulse/apps/api/prisma/data/minepulse.db` |

### MinePulse docs

- [`MinePulse/docs/ARCHITECTURE.md`](MinePulse/docs/ARCHITECTURE.md) — components, data flow, jobs.
- [`MinePulse/docs/API.md`](MinePulse/docs/API.md) — endpoint reference.
- [`MinePulse/docs/INSTALLATION.md`](MinePulse/docs/INSTALLATION.md) — full setup guide.
- [`MinePulse/docs/SECURITY.md`](MinePulse/docs/SECURITY.md) — auth, secrets, limitations.
- [`MinePulse/docs/TROUBLESHOOTING.md`](MinePulse/docs/TROUBLESHOOTING.md) — common problems.
- [`MinePulse/README.md`](MinePulse/README.md) — app-level README.
- [`MINEPULSE_BUILD_PLAN.md`](MINEPULSE_BUILD_PLAN.md) — phased build plan.

---

## 3. Repository layout (top level)

```
Minecraft_Server/
  paper.jar              Paper server jar (tracked - see note below)
  run.bat                Server launcher (JDK 25, 8 GB heap)
  server.properties      Server config            [gitignored: contains a secret]
  bukkit.yml spigot.yml  Server config            [tracked]
  commands.yml           Command aliases          [tracked]
  config/                Paper config (paper-*.yml) [tracked]
  ops.json whitelist.json banned-*.json            [tracked]
  eula.txt               EULA acceptance          [tracked]
  plugins/               Plugin jars + data + token [gitignored]
  world/                 World data                [gitignored]
  backups/ logs/ cache/ libraries/ versions/ .paper/ [gitignored]
  MinePulse/             The monitoring platform source
  .gitignore             Root ignore rules
  README.md              This file
```

---

## 4. Version control: what is and is not committed

Two `.gitignore` files control this:

- [`.gitignore`](.gitignore) — the **Minecraft server** at the repo root.
- [`MinePulse/.gitignore`](MinePulse/.gitignore) — the **MinePulse app**
  (ignores `node_modules/`, `dist/`, `target/`, `.env`, `*.db`, Maven tools).

### Tracked

- Server config: `bukkit.yml`, `spigot.yml`, `commands.yml`, `config/`,
  `eula.txt`, `run.bat`, `ops.json`, `whitelist.json`, `banned-*.json`,
  `wepif.yml`.
- `paper.jar` (the server jar).
- The full MinePulse source: `apps/api`, `apps/dashboard`, `apps/plugin`,
  `packages/shared`, docs and build plan.

### Ignored

- **World/level data** — `world/`, `world_nether/`, `world_the_end/`, `*.lock`.
- **Runtime** — `logs/`, `crash-reports/`, `*.log`.
- **Binaries/caches** — `libraries/`, `versions/`, `cache/`, `.paper/`,
  and any `*.jar` **except** `paper.jar` (`!/paper.jar`).
- **Backups** — `backups/`.
- **Plugins** — the whole `plugins/` directory (binary jars, plugin databases
  and the live agent token in `plugins/MinePulseAgent/config.yml`).
- **Secrets / local state** — `server.properties`, `usercache.json`, and
  (inside MinePulse) `.env`.
- **Archives** — `*.zip`, `*.tar`, `*.gz`, `*.dll`, `*.so`, `*.dylib`, `*.exe`.

### Why `paper.jar` is ~50 MB

`paper.jar` (51.7 MB) is tracked so the server can be restored exactly. GitHub
warns above 50 MB (hard limit 100 MB). If you update Paper, each new jar adds
~50 MB to history — consider Git LFS (`git lfs track "paper.jar"`) if that
becomes a problem.

---

## 5. Secrets & security

**This GitHub repository is public.** Credentials are deliberately kept out of
it. The following files contain real secrets and are **gitignored**:

| File | Contains |
| --- | --- |
| `server.properties` | a generated `management-server-secret` |
| `plugins/MinePulseAgent/config.yml` | the live agent token (`mp_…`) |
| `MinePulse/apps/api/.env` | `SESSION_SECRET` and `DATABASE_URL` |

`MinePulse/.env.example` **is** tracked and contains placeholders only — copy it
to `.env` and generate your own `SESSION_SECRET`.

Recommendations:

- Prefer making this repository **private** if you plan to version server
  config, or keep secrets out of it (as done here).
- Rotate the bootstrap admin password and the agent token before any real
  deployment.
- Never `git add -f` the ignored files above.

---

## 6. Git

| | |
| --- | --- |
| Remote | GitHub (SSH) |
| Branch | `main` |

```bash
git add -A
git commit -m "your message"
git push origin main
```

---

## 7. Status

Built in phases; see [`MINEPULSE_BUILD_PLAN.md`](MINEPULSE_BUILD_PLAN.md).
Nothing is reported as working unless it was verified with a real run.
