#!/usr/bin/env bash
# eWash — one-command, idempotent production deploy: bun run deploy
#
# Every resource is ENSURED, not assumed: checked for existence first, created
# only if missing, updated only if drifted. Safe to re-run any time — a no-op
# deploy changes nothing. Everything used here fits Cloudflare's free tier
# (Workers free plan, D1 free tier, secrets & cron triggers are free).
#
#   [1] auth          — verify Cloudflare login
#   [2] D1 database   — exists? create : reuse; sync database_id into wrangler.toml
#   [3] build         — compile the SPA the worker serves
#   [4] migrations    — apply only the not-yet-applied ones (wrangler tracks state per DB)
#   [5] worker        — deploy = create-or-update (code, assets, D1 binding, cron trigger)
#   [6] JWT_SECRET    — exists? keep : generate & upload
#   [7] health check  — hit /api/health on the live URL
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="lavtr"
TOML="api/wrangler.toml"

step() { echo "▶ $1"; }
ok()   { echo "  ✔ $2 — $1"; }

step "[1/7] Cloudflare auth"
if ! bunx wrangler whoami >/dev/null 2>&1; then
  echo "✖ Not authenticated with Cloudflare. Run: bunx wrangler login" >&2
  exit 1
fi
ok "authenticated" "auth"

step "[2/7] D1 database \"$DB_NAME\" (exists? reuse : create; toml synced on drift)"
bash scripts/ensure-remote-db.sh

step "[3/7] building the frontend"
bun run build >/dev/null
ok "web/dist ready" "build"

step "[4/7] remote migrations (only unapplied ones run)"
bun run db:migrate:remote
ok "schema current" "migrations"

step "[5/7] deploying the worker (create-or-update: code + assets + D1 binding + cron)"
deploy_out=$( (cd api && bunx wrangler deploy) | tee /dev/stderr )
app_url=$(echo "$deploy_out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
ok "live" "worker"

step "[6/7] production secrets (exist? keep : generate)"
secret_list=$( (cd api && bunx wrangler secret list 2>/dev/null) || echo '[]' )
ensure_secret() {
  local name="$1"
  if echo "$secret_list" | grep -q "\"$name\""; then
    ok "exists — kept as is" "$name"
  else
    echo "  $name missing — generating"
    python3 -c "import secrets; print(secrets.token_hex(32))" | (cd api && bunx wrangler secret put "$name")
    ok "created" "$name"
  fi
}
ensure_secret JWT_SECRET
ensure_secret PIX_CALLBACK_SECRET
echo "  ↳ callback Pix manual (opcional) ficará em:"
echo "    <your-app-url>/api/payments/pix/callback/<PIX_CALLBACK_SECRET>"
# These secrets come from external providers — they cannot be generated here
ensure_external_secret() {
  local name="$1" feature="$2"
  if echo "$secret_list" | grep -q "\"$name\""; then
    ok "exists — kept as is" "$name"
  else
    echo "  ⚠ $name not set — $feature stays disabled in production."
    echo "    Set it with: cd api && bunx wrangler secret put $name"
  fi
}
ensure_external_secret GOOGLE_CLIENT_SECRET "Google sign-in"
ensure_external_secret SMTP_PASSWORD "password-reset email (Gmail App Password)"

step "[7/7] health check"
if [ -n "${app_url:-}" ]; then
  sleep 3
  if curl -sf -m 15 "$app_url/api/health" >/dev/null; then
    ok "$app_url responds" "health"
    echo
    echo "✔ LavTr is live: $app_url"
  else
    echo "  ⚠ deployed, but $app_url/api/health not responding yet (secrets propagate within ~1 min — retry: curl $app_url/api/health)"
  fi
else
  echo "  ⚠ could not detect the workers.dev URL from deploy output — check the deploy log above"
fi
