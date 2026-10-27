# MinePulse

Private Minecraft **Paper** server monitoring platform: a premium dark
dashboard, a Node/TypeScript API with real-time delivery, and a custom Paper
plugin (`MinePulseAgent`) that streams telemetry to the API.

> Self-hosted, read-only monitoring for your own server. It never executes
> commands on your Minecraft server, never stores plaintext agent tokens, and
> collects chat messages for the live Chat page (with configurable keyword flagging).

## Features

- **Live overview** — server state, TPS/MSPT, memory, CPU, players, uptime.
- **Performance** — real TPS/MSPT/memory/CPU history across 15m–7d ranges.
- **Players** — roster, first/last seen, session history, daily/weekly activity.
- **Plugins** — inventory, versions, enabled state, change history.
- **Events & Logs** — searchable, filterable, expandable, CSV export.
- **Alerts** — rule CRUD, hysteresis (no flapping), incidents, per-rule
  cooldown, delivery tracking and a test button. Discord delivery is
  backend-only and reports "not configured" honestly when unset.
- **Settings** - retention windows, offline thresholds, display preferences, agent credentials, and data export/import.
- **Connection** - live API, WebSocket and agent status, a measured connection test, and links to agent credentials.
- **Real-time** — Socket.IO push so every page updates without heavy polling.
- **Background jobs** — metric aggregation and retention pruning.

## Monorepo layout

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

## Requirements

- Node.js >= 20 (tested on v24)
- **JDK 25** to build the plugin (Paper 26.3 is Java 25 bytecode)
- Paper server (tested: Paper 26.3, build 166)

## Quick start

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET

npm run db:migrate -w @minepulse/api
npm run bootstrap-admin -w @minepulse/api -- --email you@example.com

npm run dev                   # API :4000 + dashboard :5173
```

Then build and deploy the plugin:

```bash
npm run create-agent-credential -w @minepulse/api
npm run build:plugin
npm run deploy:plugin -- -Token mp_xxx
```

Restart Paper to load the plugin.

## Commands

| Command                              | Purpose                                   |
| ------------------------------------ | ----------------------------------------- |
| `npm run dev`                        | Run API + dashboard in watch mode.        |
| `npm run build`                      | Build shared + API + dashboard.           |
| `npm run typecheck`                  | Type-check every workspace.               |
| `npm test`                           | Run unit tests.                           |
| `npm run build:plugin`               | Build the Paper plugin (JDK 25).          |
| `npm run deploy:plugin -- -Token mp_`| Build + deploy the plugin into Paper.     |

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data flow, jobs.
- [`docs/API.md`](docs/API.md) — endpoint reference.
- [`docs/INSTALLATION.md`](docs/INSTALLATION.md) — full setup guide.
- [`docs/SECURITY.md`](docs/SECURITY.md) — auth, secrets, limitations.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — common problems.

The phased build plan lives one level up at `../MINEPULSE_BUILD_PLAN.md`.

## Status

Built in phases; see the build plan. Nothing is reported as working unless it was
verified with a real run.
