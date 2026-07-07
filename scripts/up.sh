#!/usr/bin/env bash
# eWash — ONE command brings everything up: bun start
#   1. install deps
#   2. build the SPA (the worker serves it — frontend origin proxies /api to the backend)
#   3. apply ALL D1 migrations: local always, remote when Cloudflare auth is available
#   4. start the single service at http://localhost:8787
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ [1/4] installing dependencies (bun)"
bun install

echo "▶ [2/4] building the frontend (served by the worker — one service)"
bun run build

echo "▶ [3/4] applying local D1 migrations"
bun run db:migrate:local

if bunx wrangler whoami >/dev/null 2>&1; then
  echo "▶ [3/4] ensuring remote D1 database + applying remote migrations"
  if bash scripts/ensure-remote-db.sh; then
    bun run db:migrate:remote || echo "  ⚠ remote migrations failed — see the wrangler output above"
  else
    echo "  ⚠ could not ensure the remote database — remote migrations skipped"
  fi
else
  echo "  ⚠ remote migrations skipped — not authenticated with Cloudflare (run: bunx wrangler login)"
fi

echo "▶ [4/4] starting eWash → http://localhost:8787 (frontend + proxied /api backend)"
exec bun run dev:api
