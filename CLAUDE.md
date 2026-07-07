# CLAUDE.md — eWash

Read this first, then `AGENTS.md` (rules that govern every contribution) and
`instructions.md` (the mandatory plan → review → implement workflow). All three
are binding. **Never start writing code before completing the workflow in
`instructions.md`.**

## What this project is

eWash is a **production-grade**, multi-tenant laundry management SaaS
(Kenya-first). The product spec, data model and reference mockup live in
`Laundry_Management_SaaS_MockUp.html` — treat it as the product source of truth.

## Architecture (do not change without explicit approval)

- **One service.** A single Cloudflare Worker (`api/`) serves the REST API at
  `/api/*` **and** the built Vue SPA from `web/dist` (SPA fallback). Never run
  or introduce a second server; never proxy vite dev against the worker.
- **Backend:** Hono on Cloudflare Workers. **All DB access goes through
  Drizzle ORM** (`drizzle-orm/d1`). Models live in `api/src/db/schema.js`.
  No raw `env.DB.prepare()` anywhere.
- **Migrations are named and generated**, never hand-written:
  `cd api && bunx drizzle-kit generate --name <change-name>` then
  `bunx wrangler d1 migrations apply eWash --local` (or `--remote`).
- **Frontend:** Vue 3 + Vite + Pinia + Vue Router in `web/`. Views compose the
  shared component library in `web/src/components/` — see reuse rules in
  `AGENTS.md`.
- **Money is integer cents** end to end. Prices on orders are **snapshots**;
  catalog edits must never mutate existing orders.
- **Every table is tenant-scoped.** Every query must filter by `tenant_id`
  (directly or through a tenant-scoped parent). A cross-tenant read is a
  release-blocking bug.
- **Authorization is server-side.** Endpoints enforce policies via
  `requirePolicy(...)`; the UI merely hides what the user can't do.
- All price-affecting actions (discount, void, refund, catalog change, user
  permission change) must be written to `audit_log`.

## Security invariants (hostile public traffic is assumed)

- **Sessions, not bare JWTs:** access tokens live 15 min and carry a session id
  checked (and heartbeated) on every request; refresh tokens rotate with reuse
  detection; logout revokes server-side. Never issue a long-lived token.
- **Auth endpoints are rate-limited** (D1-backed, `api/src/ratelimit.js`);
  production limits are strict, dev gets ×20. Any new abusable endpoint gets a
  limiter too.
- **The M-Pesa callback requires the `MPESA_CALLBACK_SECRET` URL token**; UI
  simulation goes through the authed, policy-guarded `/payments/:id/simulate`.
  Never add an unauthenticated write endpoint.
- **Secrets live in worker secrets / `api/.dev.vars`, never in wrangler.toml**;
  production refuses to serve with a weak/missing JWT_SECRET (`security.js`).
- **All input is clamped** via `api/src/security.js` (string lengths, qty,
  money, month/date formats, 64KB body cap, 128-char password cap). Reuse those
  helpers for any new field.
- Security headers: `hono/secure-headers` on `/api/*`, `web/public/_headers`
  for the SPA (CSP included). API responses are `Cache-Control: no-store`.
- The UI auto-locks after 10 idle minutes (`useIdleLock` + `LockScreen`);
  unlock is a server-verified, rate-limited password check.
- Presence (online/offline, last seen) derives from session heartbeats — see
  `tenantPresence` in `api/src/session.js`.

## Commands

**Always use bun, never npm/npx** — in commands, scripts, docs, and examples.

```bash
bun start                  # THE way to run: install + build + ALL migrations (local,
                           # and remote when authenticated) + serve on :8787
bun run build              # build SPA into web/dist  (required before dev/deploy)
bun run db:migrate:local   # apply migrations to local D1
bun run db:migrate:remote  # apply migrations to remote D1
bun run deploy             # build + wrangler deploy
```

`bun start` (= `scripts/up.sh`) is the required pre-run path: it guarantees
migrations are executed before the app serves traffic. Don't hand users or
agents a multi-step run sequence when `bun start` does it all.

Frontend changes require `bun run build` to be visible — the worker serves
`web/dist`, not the source.

## Verification is mandatory

A change is not done until it has been exercised against the running app
(build → migrate → `wrangler dev` → drive the affected flow, API via curl and
UI via headless browser where relevant). "It compiles" is not verification.
See the Definition of Done in `instructions.md`.

## Key file map

| Area | Where |
|---|---|
| Drizzle models | `api/src/db/schema.js` |
| Pricing engine (4 strategies + riders) | `api/src/pricing.js` |
| RBAC policy catalog / role templates | `api/src/policies.js` |
| Route modules | `api/src/routes/*.js` |
| Notifications (templates + provider stub) | `api/src/notify.js` |
| Tenant onboarding seed | `api/src/seed.js` |
| Shared UI components | `web/src/components/` |
| Views (screens) | `web/src/views/` |
| API client / stores / formatting | `web/src/api.js`, `web/src/stores/`, `web/src/utils/format.js` |
| Design tokens & global styles | `web/src/style.css` |
