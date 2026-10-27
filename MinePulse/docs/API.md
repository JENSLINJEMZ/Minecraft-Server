# API reference

Base URL: `http://127.0.0.1:4000/api/v1`

Two independent authentication channels:

- **Dashboard** endpoints use a session cookie (`minepulse_session`) plus a
  `x-csrf-token` header for any state-changing request.
- **Agent** endpoints use an agent token in the `x-agent-token` header.

Errors are returned as `{ "error": { "code", "message", "requestId", "details"? } }`.

## Health

| Method | Path      | Auth | Description        |
| ------ | --------- | ---- | ------------------ |
| GET    | `/health` | none | Liveness + uptime. |

## Auth

| Method | Path      | Auth    | Description                          |
| ------ | --------- | ------- | ------------------------------------ |
| POST   | `/auth/login`  | none | `{ email, password }` → user + csrfToken |
| POST   | `/auth/logout` | session | Ends the session.               |
| GET    | `/auth/me`     | session | Current user + csrfToken.       |

## Agent (telemetry ingest)

All agent routes require `x-agent-token`.

| Method | Path               | Description                                        |
| ------ | ------------------ | -------------------------------------------------- |
| GET    | `/agent/context`   | Resolve `serverId` and echo expected schema version. |
| POST   | `/agent/heartbeat` | Player count, uptime, versions, identity.           |
| POST   | `/agent/metrics`   | TPS (1m/5m/15m), MSPT, heap, CPU.                   |
| POST   | `/agent/events`    | Batched structured events.                          |
| POST   | `/agent/plugins`   | Plugin inventory snapshot.                          |

Payloads are validated against the shared Zod schemas (`@minepulse/shared`).
Duplicate submissions (same `requestId`) are ignored.

## Server (read models, session auth)

| Method | Path                                | Description                                   |
| ------ | ----------------------------------- | --------------------------------------------- |
| GET    | `/server`                           | Server identity.                              |
| PATCH  | `/server/profile`                   | Admin + CSRF. Rename the server display name. |
| GET    | `/server/status`                    | Derived state, agent connectivity, freshness, agent version and schema version. |
| GET    | `/server/metrics/current`           | Newest metric sample.                         |
| GET    | `/server/metrics/history?range=`    | `15m`, `1h`, `6h`, `24h`, `7d`.               |
| GET    | `/server/events`                    | Filter: `severity`, `category`, `from`, `to`, `search`, `page`, `pageSize`. |
| GET    | `/server/events/recent?limit=`      | Most recent events.                           |
| GET    | `/server/plugins`                   | Current plugin inventory snapshot.            |
| GET    | `/server/plugins/history`           | Inventory change history.                     |
| GET    | `/server/players?page=&pageSize=`   | Known players.                                |
| GET    | `/server/players/:uuid`             | Player detail.                                |
| GET    | `/server/players/:uuid/sessions`    | Session history.                              |
| GET    | `/server/activity?days=`            | Daily/weekly activity.                        |

## Alerts

| Method | Path                    | Auth          | Description                          |
| ------ | ----------------------- | ------------- | ------------------------------------ |
| GET    | `/alerts`               | session       | Rules + recent incidents + Discord status. |
| POST   | `/alerts`               | admin + CSRF  | Create a rule.                       |
| PATCH  | `/alerts/:id`           | admin + CSRF  | Update a rule (partial).             |
| DELETE | `/alerts/:id`           | admin + CSRF  | Delete a rule (cascades incidents).  |
| POST   | `/alerts/:id/test`      | admin + CSRF  | Send a test notification.            |
| GET    | `/alerts/:id/incidents` | session       | Incidents for a rule.                |

`POST /alerts/:id/test` returns `{ ok, status, message }` where `status` is
`delivered | failed | skipped`. `skipped` means no Discord webhook is configured.

### Rule fields

```jsonc
{
  "name": "TPS below 15",
  "metric": "tps",            // heartbeat_missing | agent_disconnected | tps |
                              // mspt | heap_percent | player_count | repeated_incidents
  "operator": "lt",           // lt | lte | gt | gte | eq
  "threshold": 15,
  "evaluationWindowSeconds": 60,
  "severity": "warning",      // info | warning | critical
  "cooldownSeconds": 600,
  "enabled": true
}
```

## Settings

| Method | Path                                      | Auth         | Description                                      |
| ------ | ----------------------------------------- | ------------ | ------------------------------------------------ |
| GET    | `/settings`                               | session      | Retention + thresholds + Discord status + defaults. |
| PATCH  | `/settings`                               | admin + CSRF | Update retention/threshold values.               |
| GET    | `/settings/security`                      | admin        | Current session, agent credential prefixes, team, bind address. |
| POST   | `/settings/agent-credentials`             | admin + CSRF | Create an agent credential. The raw token is returned once. |
| POST   | `/settings/agent-credentials/:id/revoke`  | admin + CSRF | Revoke an agent credential.                      |
| POST   | `/settings/retention/run`                 | admin + CSRF | Run the retention sweep now and return row counts. |

`PATCH /settings` requires `heartbeatOfflineSeconds` to be greater than
`heartbeatStaleSeconds` after the patch is merged with stored values. The
dashboard uses `defaults` from `GET /settings` to implement "Reset defaults".
`GET /settings/security` never returns raw tokens, token hashes or the Discord
webhook URL.

## Export (CSV, session auth)

| Method | Path                         | Description                                   |
| ------ | ---------------------------- | --------------------------------------------- |
| GET    | `/export/metrics?range=`     | All metric points for the range as CSV.       |
| GET    | `/export/events?...filters`  | All matching events (bounded) as CSV.         |

Both respond with `Content-Type: text/csv` and a `Content-Disposition`
attachment filename.

## Socket.IO

Namespace `/`, path `/socket.io`. Handshake is authenticated with the session
cookie only (unauthenticated sockets are rejected). Events:
`server:status`, `server:metrics`, `server:players`, `server:plugins`,
`server:event`, `server:chat`, `alert:triggered`, `alert:resolved`.

## Chat

| Method | Path                | Auth    | Description |
| ------ | ------------------- | ------- | ----------- |
| GET    | `/server/chat`      | session | Paginated chat log from `chat_message` events (`items`, `page`, `pageSize`, `total`, `stats`). Supports `search`, `playerName`, `flagged`, `source`. |

Rows include `playerId`, `playerName`, `message`, `flagged`, `muted`, `source` (`chat` or `broadcast`). Keyword auto-flagging is captured at the Paper agent and stored in event details; broadcasts recorded by the dashboard are emitted as chat rows on successful delivery.
