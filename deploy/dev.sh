#!/usr/bin/env bash
# Run an Alpha Gate Worker LOCALLY (§23 local surface) — Miniflare-backed D1 + R2, no Cloudflare
# account, no network. Renders a local wrangler config from the shared template, applies migrations to
# a local database, seeds a demo client/build (so /get, /appcast, /download return real data), and
# starts `wrangler dev`. Re-runnable: migrations and seed are idempotent; state lives under .wrangler/.
#
#   ./deploy/dev.sh                 # public App Worker on :8787, seeded
#   ./deploy/dev.sh --port 9000     # choose the port
#   ./deploy/dev.sh --no-seed       # start with an empty database
#   ./deploy/dev.sh --reset         # wipe local D1/R2 state first
#   ./deploy/dev.sh --role admin    # the gated Admin Worker (see the Access caveat printed below)
set -euo pipefail

ROLE="app"
PORT="8787"
SEED=1
RESET=0
# A valid Crockford base32 token (32 chars, no I/L/O/U) — the seeded demo client's access token.
TOKEN="DEV0DEV0DEV0DEV0DEV0DEV0DEV0DEV0"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --role)    ROLE="${2:-}"; shift 2 ;;
    --port)    PORT="${2:-}"; shift 2 ;;
    --no-seed) SEED=0; shift ;;
    --reset)   RESET=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done
case "${ROLE}" in app|admin) ;; *) echo "--role must be 'app' or 'admin'" >&2; exit 1 ;; esac

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}
require_cmd npx
require_cmd envsubst

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${ROOT}/.deploy"
STATE_DIR="${ROOT}/.wrangler/state"   # under the .gitignored .wrangler/; shared by both roles
DB="alpha-gate-local"
CFG="${DEPLOY_DIR}/local.${ROLE}.toml"
mkdir -p "${DEPLOY_DIR}"

if [ "${RESET}" -eq 1 ]; then
  rm -rf "${STATE_DIR}"
  echo "local D1/R2 state reset."
fi

NAME="${DB}"
if [ "${ROLE}" = "admin" ]; then NAME="${DB}-admin"; fi

# 1. Render a local wrangler config from the shared template (pure envsubst — no account calls). Email
#    stays off locally; both roles point at the same local DB/bucket (INSTANCE=local).
INSTANCE="local" D1_ID="local" EMAIL_PROVIDER="none" EMAIL_FROM="" \
  ROLE="${ROLE}" NAME="${NAME}" \
  TOOL_VERSION="$(cat "${ROOT}/VERSION" 2>/dev/null || echo "0.0.0")" \
  UPDATE_MANIFEST_URL="https://example.invalid/release.json" SEND_EMAIL="" \
  envsubst < "${ROOT}/deploy/wrangler.template.toml" > "${CFG}"

# 1b. Admin role: there is no Cloudflare Access on localhost, so repoint `main` at the dev-only
#     entrypoint (src/dev/admin-entry.ts). It runs the real admin app + verifier against a throwaway
#     keypair and auto-injects a dev assertion so the UI is browser-usable. This rewrite is contained to
#     dev.sh — the production template/deploy.sh never touch this entry, so it cannot ship.
if [ "${ROLE}" = "admin" ]; then
  TMP="$(mktemp)"
  while IFS= read -r line; do
    case "${line}" in
      main\ =*) printf 'main = "../src/dev/admin-entry.ts"\n' ;;
      *) printf '%s\n' "${line}" ;;
    esac
  done < "${CFG}" > "${TMP}"
  mv "${TMP}" "${CFG}"
fi

# 2. Apply migrations to the LOCAL database.
npx wrangler d1 migrations apply "${DB}" --config "${CFG}" --local --persist-to "${STATE_DIR}"

# 3. Seed a demo world (idempotent) so the public surface returns real data.
if [ "${SEED}" -eq 1 ]; then
  TMP_ZIP="$(mktemp)"
  printf 'ALPHA-GATE-DEV-ARCHIVE' > "${TMP_ZIP}"
  LEN="$(wc -c < "${TMP_ZIP}" | tr -d ' ')"
  npx wrangler r2 object put "${DB}/build/1000/App.zip" --file "${TMP_ZIP}" \
    --content-type application/zip --local --persist-to "${STATE_DIR}" >/dev/null
  rm -f "${TMP_ZIP}"
  npx wrangler d1 execute "${DB}" --config "${CFG}" --local --persist-to "${STATE_DIR}" --command \
"INSERT OR IGNORE INTO streams (name) VALUES ('local');
 INSERT OR IGNORE INTO clients (email, token, status) VALUES ('dev@example.test', '${TOKEN}', 'active');
 INSERT OR IGNORE INTO builds (short_version, build_number, object_key, ed_signature, length, status)
   VALUES ('1.0.0-dev', 1000, 'build/1000/App.zip', 'DEVSIG==', ${LEN}, 'available');
 INSERT OR IGNORE INTO build_streams (build_id, stream_id)
   SELECT b.id, s.id FROM builds b JOIN streams s ON s.name = 'local' WHERE b.build_number = 1000;
 INSERT OR IGNORE INTO user_streams (client_id, stream_id)
   SELECT c.id, s.id FROM clients c JOIN streams s ON s.name = 'local' WHERE c.email = 'dev@example.test';" \
    >/dev/null
fi

# 4. Banner, then hand off to wrangler dev (foreground; Ctrl-C stops it).
BASE="http://localhost:${PORT}"
echo
echo "Alpha Gate — local ${ROLE} Worker on ${BASE}  (Miniflare; no Cloudflare account)"
if [ "${ROLE}" = "app" ]; then
  if [ "${SEED}" -eq 1 ]; then
    cat <<EOF
Seeded demo: client dev@example.test · build 1000 (1.0.0-dev) in channel 'local'
Try it:
  Landing page : ${BASE}/get?token=${TOKEN}
  Sparkle feed : curl "${BASE}/appcast?token=${TOKEN}&installed=1"
  Download     : curl -L "${BASE}/download?token=${TOKEN}&via=install" -o app.zip
  Request form : ${BASE}/access
Note: the seeded EdDSA signature is a placeholder — fine for exploring the Worker, but a real Sparkle
client would reject the update. Use \`npm test\` for end-to-end logic coverage (offline).
EOF
  else
    echo "Empty database (--no-seed). Add data via the Admin Worker or wrangler d1 execute."
  fi
else
  cat <<EOF
Open the back office: ${BASE}/admin
LOCAL-DEV AUTH SHIM — there is no Cloudflare Access here, so every request is treated as admin
'dev@local' (the real verifier runs against a throwaway in-process keypair). This is localhost-only and
CANNOT ship: the dev entrypoint is never wired into worker.ts or the deploy template, and refuses to
run without DEV_ADMIN=1. Anyone who can reach :${PORT} is admin while this is up.
EOF
fi
echo "Ctrl-C to stop."
echo

if [ "${ROLE}" = "admin" ]; then
  exec npx wrangler dev --config "${CFG}" --port "${PORT}" --local --persist-to "${STATE_DIR}" \
    --var DEV_ADMIN:1
else
  exec npx wrangler dev --config "${CFG}" --port "${PORT}" --local --persist-to "${STATE_DIR}"
fi
