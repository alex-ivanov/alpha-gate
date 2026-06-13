#!/usr/bin/env bash
# Destroy one Alpha Gate instance (§21): both Workers, the R2 bucket (emptied first), and the D1
# database. Everything is namespaced by the slug, so other instances are untouched. The Access app is
# removed from the dashboard separately. Destructive — prompts unless --yes. --dry-run mocks wrangler.
set -euo pipefail

INSTANCE=""
DRY_RUN=0
ASSUME_YES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance) INSTANCE="${2:-}"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --yes)      ASSUME_YES=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done
[ -n "${INSTANCE}" ] || { echo "--instance is required" >&2; exit 1; }
case "${INSTANCE}" in
  *[!a-z0-9-]* | -* | *- )
    echo "invalid --instance: lowercase letters, digits and hyphens only (no leading/trailing hyphen)" >&2
    exit 1 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RES="alpha-gate-${INSTANCE}"
DEPLOY_DIR="${ROOT}/.deploy"

wrangler() {
  if [ "${DRY_RUN}" -eq 1 ]; then
    echo "[dry-run] wrangler $*" >&2
    return 0
  fi
  npx wrangler "$@"
}

if [ "${ASSUME_YES}" -eq 0 ] && [ "${DRY_RUN}" -eq 0 ]; then
  printf 'This permanently deletes instance "%s" (Workers, R2 bucket, D1 database). Type the instance name to confirm: ' "${INSTANCE}"
  read -r reply
  [ "${reply}" = "${INSTANCE}" ] || { echo "aborted" >&2; exit 1; }
fi

wrangler delete --name "${RES}" || true
wrangler delete --name "${RES}-admin" || true

# R2 bucket delete requires the bucket be empty. Surface failure loudly rather than silently
# orphaning the bucket and its objects (empty it via the dashboard / `wrangler r2 object delete`).
if ! wrangler r2 bucket delete "${RES}"; then
  echo "WARN: R2 bucket ${RES} was NOT deleted (likely non-empty). Empty it, then delete it manually." >&2
fi

wrangler d1 delete "${RES}" --skip-confirmation || true

rm -f "${DEPLOY_DIR}/${INSTANCE}.app.toml" \
      "${DEPLOY_DIR}/${INSTANCE}.admin.toml" \
      "${DEPLOY_DIR}/${INSTANCE}.state.json"

echo "Removed instance ${INSTANCE}. (Remove its Cloudflare Access app from the dashboard separately.)"
