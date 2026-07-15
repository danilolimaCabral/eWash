#!/usr/bin/env bash
# Push the TextSMS credentials from api/.dev.vars to production worker secrets.
# Usage: bash scripts/push-sms-secrets.sh   (requires: bunx wrangler login)
set -euo pipefail
cd "$(dirname "$0")/../api"

if ! bunx wrangler whoami >/dev/null 2>&1; then
  echo "✘ Not authenticated with Cloudflare — run: bunx wrangler login" >&2
  exit 1
fi

for KEY in SMS_API_KEY SMS_PARTNER_ID SMS_SHORTCODE; do
  VALUE=$(grep -E "^${KEY}=" .dev.vars | head -1 | cut -d= -f2-)
  if [ -z "$VALUE" ]; then
    echo "✘ $KEY is not set in api/.dev.vars — fill it in first" >&2
    exit 1
  fi
  printf '%s' "$VALUE" | bunx wrangler secret put "$KEY"
  echo "✔ $KEY pushed"
done

echo "Done. SMS_BASE_URL is already a [vars] entry in wrangler.toml — no secret needed."
echo "Redeploy (bun run deploy) or the next deploy will pick the secrets up automatically."
