# Troubleshooting

## The plugin won't compile

**Symptom:** `class file has wrong version 69.0, should be ...`

Paper 26.3 is Java 25 bytecode. Build the plugin with **JDK 25**. The bundled
`build.ps1` locates a JDK 25 automatically; if it cannot, set one explicitly:

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-25"
npm run build:plugin
```

## Login works but every page says "The API could not be reached"

**Symptom:** you can sign in, but cards/charts show "The API could not be
reached. Is the MinePulse API running on port 4000?" (or empty pages), even
though the API is up.

**Cause:** the dashboard and the API were opened on **different hostnames** —
for example the dashboard at `http://localhost:5173` while the API answers on
`http://127.0.0.1:4000`. `localhost` and `127.0.0.1` are *different sites* for
cookie purposes, so the `SameSite=Lax` session cookie is stored but never sent
on the data requests. Login appears to succeed (the user is kept in memory), and
then every authenticated request (`/server`, `/server/status`, …) is anonymous
(401).

**Fix:** use the **same hostname for both**. The dashboard now targets the API on
the hostname the page was loaded from (so `localhost` → `localhost:4000`,
`127.0.0.1` → `127.0.0.1:4000`), and the API allows both origins by default.
Open one URL and stick to it, e.g.:

```
http://127.0.0.1:5173
```

If you still see it, make sure `CORS_ORIGINS` in the API `.env` contains the
exact origin you are using and that you changed nothing else:

```
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Then sign out and sign in again (the old session cookie may be for the other
host).

## The plugin loads but the dashboard stays offline / stale

1. Check the agent token in `plugins/MinePulseAgent/config.yml` matches a live
   credential (`npm run create-agent-credential -w @minepulse/api`).
2. Check `api-url` points at the running API (`http://127.0.0.1:4000`).
3. In-game run `/minepulse test` (needs `minepulse.admin`) and read the response.
   `/minepulse status` shows the resolved `serverId` and last send times.
4. Enable `debug-logging: true` in the plugin config and re-check the server log.

Forgetting the `agent-token` is the most common cause; the plugin logs a warning
on its first failed send.

## "no key id in MapLike" spam in the server log

That is a vanilla/Paper warning from world data, unrelated to MinePulse.

## Dashboard shows `stale` then `offline` although the server is running

`stale` means no heartbeat within `heartbeatStaleSeconds`; `offline` within
`heartbeatOfflineSeconds`. Raise these in **Settings** if your agent interval is
longer than the thresholds, or lower the plugin's `heartbeat-interval`.

## Discord alerts show "not configured"

That is expected until you set a webhook. Put `DISCORD_WEBHOOK_URL` in the API
`.env` and restart the API. The webhook value is never shown in the UI; the
Settings/Alerts pages only report whether one is configured.

## A rule isn't opening an incident

- Rules are evaluated every 10 seconds and need **two consecutive breaching
  samples** (hysteresis) before an incident opens. A single blip is ignored by
  design.
- Check the rule is **enabled**.
- Check the rule's **cooldown**: a new incident is suppressed until the cooldown
  after the previous one ends.
- Confirm the metric has a value. Rules over a metric that is currently `null`
  (e.g. `tps` before the first telemetry) do nothing until data arrives.

## `prisma generate` fails with EPERM / file lock (Windows)

The Prisma engine DLL is locked while the API is running. Stop the API first:

```powershell
# stop the tsx/node API process, then:
npm run db:generate -w @minepulse/api
```

## API port already in use

Something else is on 4000 (often a previous API instance). Find and stop it:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'tsx|src/server' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Where is the database?

`apps/api/prisma/data/minepulse.db` (relative to `DATABASE_URL` in `.env`).
Inspect it with `npm run db:studio -w @minepulse/api`.

## Charts are empty for long ranges

Long ranges (6h/24h/7d) read from the rollup tables. The aggregation job builds
them every minute; right after a fresh install they fill in within a few
minutes. Short ranges (15m/1h) read raw samples directly.

## Resetting everything

Stop the API/dashboard, delete `apps/api/prisma/data/minepulse.db`, run
`npm run db:migrate -w @minepulse/api`, then `bootstrap-admin` again, and mint a
new agent credential. Re-deploy the plugin with the new token.
