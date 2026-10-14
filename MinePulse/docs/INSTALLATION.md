# Installation

MinePulse runs next to your Paper server on the same machine (localhost only by
default).

## Prerequisites

| Tool       | Version                          | Notes                                   |
| ---------- | -------------------------------- | --------------------------------------- |
| Node.js    | >= 20 (tested v24)               | Runs the API, dashboard and build tools.|
| JDK 25     | **required to build the plugin** | Paper 26.3 is Java 25 bytecode.         |
| Paper      | 26.3 build 166 (tested)          | The monitored server.                   |
| Maven      | bundled at `tools/apache-maven-3.9.9` | No global Maven needed.            |

The plugin compiles against `io.papermc.paper:paper-api:26.3.build.166-beta` and
**must** be compiled with JDK 25 (`maven.compiler.release=25`). Building with an
older JDK fails with a class-file-version error. `build.ps1` locates a JDK 25
automatically (checking known install paths) so you do not need to change your
global `JAVA_HOME`.

## 1. Install dependencies

```bash
cd MinePulse
npm install
```

## 2. Configure the API

```bash
cp .env.example .env
```

Edit `.env`:

- `SESSION_SECRET` — generate one:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `DATABASE_URL` — defaults to `file:./data/minepulse.db` (relative to the API
  workspace).
- `DISCORD_WEBHOOK_URL` — leave blank to disable notifications. The UI will show
  "not configured" until you set it.

## 3. Create the database and an admin

```bash
npm run db:migrate -w @minepulse/api
npm run bootstrap-admin -w @minepulse/api -- --email you@example.com
```

The bootstrap script prints a generated password once (or use `--password`).
Keep it somewhere safe.

## 4. Run the stack

```bash
npm run dev
```

- Dashboard: http://127.0.0.1:5173 (or http://localhost:5173 — use one and stay on it)
- API: http://127.0.0.1:4000

> Keep the dashboard and API on the **same hostname** (`127.0.0.1` or
> `localhost`). They are different sites for cookies, so mixing them makes the
> session cookie cross-site and every authenticated request fails. The
> dashboard targets the API on the hostname it was loaded from, and the default
> `CORS_ORIGINS` allows both.

`npm run dev` starts the API (`tsx watch`) and the dashboard (Vite) together.

## 5. Build and deploy the plugin

```bash
# 1. mint an agent token (shown once, stored only as a hash)
npm run create-agent-credential -w @minepulse/api

# 2. build + deploy the jar and write config.yml
npm run build:plugin
npm run deploy:plugin -- -Token mp_xxx
```

Deploy layout:

- `plugins/MinePulseAgent-0.1.0.jar` — the plugin jar (loaded by Paper).
- `plugins/MinePulseAgent/config.yml` — the plugin's **data folder** config.

The server only loads plugin jars at startup, so restart Paper afterwards.

## 6. Verify

1. The dashboard Overview shows `online` with a fresh heartbeat.
2. The plugin logs `MinePulseAgent enabled` with no errors.
3. In-game (as an op): `/minepulse status`, `/minepulse test`.

## Production notes

- Bind the API to `127.0.0.1` (the default) and keep the dashboard on
  localhost. If you expose them beyond localhost, put them behind a reverse
  proxy with TLS and tighten `CORS_ORIGINS`.
- The dashboard has the API base URLs baked in at build time via
  `VITE_API_BASE_URL` / `VITE_SOCKET_URL`.
- Build the dashboard with `npm run build` and serve `apps/dashboard/dist`
  however you prefer.

## Changing the agent token later

Create a new credential, deploy it with `-Token`, and delete the old one from
the database. Tokens are never recoverable in plaintext.
