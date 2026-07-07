#!/usr/bin/env bash
# Ensure the remote D1 database exists and api/wrangler.toml carries its real
# database_id. Idempotent: creates only if missing, rewrites the toml only on
# drift. Used by both `bun start` (pre-run) and `bun run deploy`.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="ewash"
TOML="api/wrangler.toml"

# Fail fast with a clear message if Cloudflare auth has expired — the token
# can look valid to `whoami` (cached) yet be rejected by the API (code 10000).
if ! (cd api && bunx wrangler d1 list --json >/dev/null 2>&1); then
  echo "  ⚠ Cloudflare API rejected the request — your wrangler login has expired." >&2
  echo "    Re-authenticate with: bunx wrangler login" >&2
  exit 1
fi

# Parse tolerantly: a non-JSON/empty response yields no id instead of crashing.
get_db_id() {
  (cd api && bunx wrangler d1 list --json 2>/dev/null) | python3 -c "
import json, sys
try:
    dbs = json.load(sys.stdin)
except Exception:
    dbs = []
print(next((d['uuid'] for d in dbs if d.get('name') == '$DB_NAME'), ''))
"
}

db_id=$(get_db_id)
if [ -z "$db_id" ]; then
  echo "  remote D1 database \"$DB_NAME\" missing — creating (free tier)"
  (cd api && bunx wrangler d1 create "$DB_NAME" >/dev/null)
  db_id=$(get_db_id)
  [ -n "$db_id" ] || { echo "✖ failed to create D1 database" >&2; exit 1; }
  echo "  ✔ created ($db_id)"
else
  echo "  ✔ exists ($db_id)"
fi

python3 - "$TOML" "$db_id" <<'PY'
import re, sys
path, db_id = sys.argv[1], sys.argv[2]
src = open(path).read()
new = re.sub(r'(?m)^database_id\s*=\s*".*"$', f'database_id = "{db_id}"', src)
if new != src:
    open(path, 'w').write(new)
    print("  ✔ wrangler.toml database_id synced")
else:
    print("  ✔ wrangler.toml database_id already in sync")
PY
