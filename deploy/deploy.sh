#!/usr/bin/env bash
# Provision and deploy one Alpha Gate instance (§19). Idempotent: re-run to update in place — D1/R2
# are reused, pending migrations applied, both Workers redeployed. Pure wrangler; no API token/DNS.
# --dry-run mocks wrangler so the whole flow (config render, state, checklist) can be exercised offline.
set -euo pipefail

INSTANCE=""
EMAIL_PROVIDER="none"
EMAIL_FROM=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance)       INSTANCE="${2:-}"; shift 2 ;;
    --email-provider) EMAIL_PROVIDER="${2:-}"; shift 2 ;;
    --email-from)     EMAIL_FROM="${2:-}"; shift 2 ;;
    --dry-run)        DRY_RUN=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done
[ -n "${INSTANCE}" ] || { echo "--instance is required" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RES="alpha-gate-${INSTANCE}"
TOOL_VERSION="$(cat "${ROOT}/VERSION" 2>/dev/null || echo "0.0.0")"
UPDATE_MANIFEST_URL="${UPDATE_MANIFEST_URL:-https://raw.githubusercontent.com/your-org/alpha-gate/main/release.json}"
DEPLOY_DIR="${ROOT}/.deploy"
mkdir -p "${DEPLOY_DIR}"

# wrangler wrapper: in --dry-run, echo the command instead of invoking the real CLI.
wrangler() {
  if [ "${DRY_RUN}" -eq 1 ]; then
    echo "[dry-run] wrangler $*" >&2
    return 0
  fi
  npx wrangler "$@"
}

# 1. D1 — create if absent, capture id.
if [ "${DRY_RUN}" -eq 1 ]; then
  D1_ID="dry-run-d1-id"
else
  D1_ID="$(wrangler d1 list --json | jq -r --arg n "${RES}" '.[]|select(.name==$n)|.uuid' || true)"
  if [ -z "${D1_ID}" ] || [ "${D1_ID}" = "null" ]; then
    wrangler d1 create "${RES}" >/dev/null
    D1_ID="$(wrangler d1 list --json | jq -r --arg n "${RES}" '.[]|select(.name==$n)|.uuid')"
  fi
fi

# 2. R2 — create if absent.
if [ "${DRY_RUN}" -eq 0 ]; then
  wrangler r2 bucket list | grep -q "^${RES}\b" || wrangler r2 bucket create "${RES}" >/dev/null
fi

# 3. Render the wrangler config for both roles from the one template.
render() {
  role="$1"
  name="$2"
  INSTANCE="${INSTANCE}" D1_ID="${D1_ID}" EMAIL_PROVIDER="${EMAIL_PROVIDER}" EMAIL_FROM="${EMAIL_FROM}" \
    ROLE="${role}" NAME="${name}" TOOL_VERSION="${TOOL_VERSION}" UPDATE_MANIFEST_URL="${UPDATE_MANIFEST_URL}" \
    envsubst < "${ROOT}/deploy/wrangler.template.toml" > "${DEPLOY_DIR}/${INSTANCE}.${role}.toml"
}
render app "${RES}"
render admin "${RES}-admin"

# 4. Apply migrations once against the shared database.
wrangler d1 migrations apply "${RES}" --config "${DEPLOY_DIR}/${INSTANCE}.app.toml" --remote

# 5. Deploy both Workers and capture their URLs.
if [ "${DRY_RUN}" -eq 1 ]; then
  wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.app.toml"
  wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml"
  APP_URL="https://${RES}.<account>.workers.dev"
  ADM_URL="https://${RES}-admin.<account>.workers.dev"
else
  APP_URL="$(wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.app.toml" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -n1)"
  ADM_URL="$(wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -n1)"
fi

# 6. Persist state and print the one-time manual checklist.
jq -n --arg i "${INSTANCE}" --arg a "${APP_URL}" --arg m "${ADM_URL}" --arg d "${D1_ID}" \
  '{instance:$i, app_url:$a, admin_url:$m, d1_id:$d}' > "${DEPLOY_DIR}/${INSTANCE}.state.json"

cat <<EOF

Deployed:
  App   (public) -> ${APP_URL}     # users + Sparkle
  Admin (gated)  -> ${ADM_URL}     # back office

Finish setup (manual, one-time):
  1. Protect the admin Worker with Cloudflare Access (Dashboard -> the
     "${RES}-admin" Worker -> Settings -> Domains & Routes -> enable Access),
     then add your email to the policy (one-time PIN).
  2. Tell the admin Worker its Access identity:
       npx wrangler secret put ACCESS_TEAM_DOMAIN --config .deploy/${INSTANCE}.admin.toml
       npx wrangler secret put ACCESS_AUD         --config .deploy/${INSTANCE}.admin.toml
       npx wrangler deploy --config .deploy/${INSTANCE}.admin.toml
  3. Publish the first build (on macOS):  ./publish.sh --instance ${INSTANCE}
  4. (optional) Email: upgrade to Workers Paid, onboard a sending domain, then
     re-run with --email-provider cloudflare --email-from alpha@<your-domain>.
EOF
