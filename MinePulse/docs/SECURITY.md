# Security

MinePulse is designed to be a **private, localhost-only** companion for your own
server. This document describes what it does and does not protect against.

## What MinePulse never does

- It never executes commands on the Minecraft server. The plugin only reads
  state.
- It does not collect or store chat messages.
- It never stores agent tokens or the Discord webhook in plaintext (see below).

## Authentication

### Dashboard users

- Passwords are hashed with **Argon2** (`@node-rs/argon2`).
- Login creates a **database-backed session**; the browser receives an
  `httpOnly`, `SameSite=Lax` signed cookie (`secure` in production), signed with
  `SESSION_SECRET`.
- Sessions expire and are validated on every request.
- Login is **rate limited** to slow password guessing.
- Mutating endpoints additionally require the **admin** role.

### CSRF

State-changing dashboard requests must carry the per-session token in the
`x-csrf-token` header (double-submit). Requests without a valid token are
rejected. Combined with `SameSite=Lax` cookies and a strict CORS allowlist, this
blocks cross-site request forgery.

### Agents

- Agent tokens look like `mp_<43 url-safe chars>` and are generated with a CSPRNG.
- Each token has a short, non-secret **prefix** used for lookup and display.
- Only the **SHA-256 hash** of the token is stored. Comparison is
  constant-time.
- Agent routes accept the token only in the `x-agent-token` header.
- Credentials can be created and revoked by an admin from **Settings > Security**
  or with the `create-agent-credential` CLI. Raw tokens are shown once.

## Transport & exposure

- By default the API binds to `127.0.0.1` and the dashboard is served on
  localhost. **Do not expose them directly to the internet.**
- CORS is restricted to `CORS_ORIGINS`.
- If you must serve remotely, terminate TLS at a reverse proxy, keep the API on
  loopback, and set `CORS_ORIGINS` to your exact dashboard origin.

## Secrets handling

| Secret                | Where it lives                         | Notes                                   |
| --------------------- | -------------------------------------- | --------------------------------------- |
| `SESSION_SECRET`      | `.env` (gitignored)                    | Signs session cookies. Rotate to log everyone out. |
| `DATABASE_URL`        | `.env`                                 | SQLite path.                            |
| Agent token           | plugin `config.yml` + hashed in the DB | Shown once at creation.                 |
| `DISCORD_WEBHOOK_URL` | API `.env` only                        | **Never** sent to the dashboard or logged. |

The Discord webhook is read only by the backend notifier. The dashboard learns
only the boolean `discordConfigured`.

## Other protections

- `helmet` sets conservative HTTP security headers.
- Every request carries a request id for correlation.
- Privileged mutations (alert rules, settings) are written to an **audit log**
  with the acting user.
- All request bodies and query strings are validated with Zod before use.

## Known limitations

- The default deployment has **no TLS**; it is intended for localhost.
- SQLite allows a single writer; this is fine for a single self-hosted server but
  is not a multi-tenant database.
- There is no built-in MFA or account self-service. Add admins with
  `bootstrap-admin` and manage them directly if needed.
- A compromised dashboard admin account can read all monitoring data and change
  settings — protect the account and rotate `SESSION_SECRET` if you suspect
  exposure.

## Dependency audit

`npm audit` is reviewed as part of the release checklist. As of the last review
the only finding in code that ships to the browser was an advisory against
**`react-router-dom` < 7.18** (open redirect via backslash in `<Link>` /
`useNavigate`, and an SSR-hydration constructor-injection issue that does not
apply to this client-only SPA). The dashboard was upgraded to
`react-router-dom@7.18.4`, which cleared it.

Every **remaining** advisory (`npm audit` reports 16: 2 critical, 9 high,
5 moderate) is confined to **development/build tooling** that is not part of the
deployed runtime or the browser bundle:

| Chain                     | Packages                                                                 | Notes                                             |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| Vitest / Vite             | `vitest`, `@vitest/mocker`, `vite`, `vite-node`, `tinypool`, `esbuild`     | Test runner + dev server only.                    |
| Tailwind / PostCSS        | `tailwindcss`, `chokidar`, `braces`, `micromatch`, `fast-glob`, `postcss-*` | Build-time CSS tooling; several advisories have no patched release. |
| Prisma CLI                | `prisma`, `@prisma/config`, `deepmerge-ts`                                | Migration/generate CLI only. `@prisma/client` (the runtime) is **not** affected. |

These are not exploitable here because:

- they are never installed on a machine that runs the dashboard/API in
  production (`npm ci --omit=dev` does not install them), and
- the DoS/path-traversal advisories require an attacker to already control
  build/test input, and the dev servers bind to localhost.

`npm audit fix` reports **"up to date"** — no finding has a fix that stays within
its declared semver range. Resolving the rest requires major upgrades
(`tailwindcss@4`, `vitest@5`) that would ripple through the build. They are
tracked as future work rather than force-applied. Re-check with:

```bash
npm audit
```

## Reporting

This is a private project. If you extend it, keep the invariants above (hashed
tokens, backend-only webhook, admin+CSRF on mutations) intact.
