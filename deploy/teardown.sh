#!/usr/bin/env bash
# Destroy one Alpha Gate instance (§21): both Workers and the D1 database (and the R2 bucket if it is
# already empty). Everything is namespaced by the slug, so other instances are untouched. By default it
# first ARCHIVES the database to a timestamped .sql (pass --no-archive to skip). Two things it can't do
# with pure wrangler — and which you finish in the dashboard — are emptying/deleting a non-empty R2
# bucket (no bulk-list API) and removing the Cloudflare Access app. Destructive; prompts unless --yes.
set -euo pipefail

INSTANCE=""
DRY_RUN=0
ASSUME_YES=0
ARCHIVE=1
ARCHIVE_DIR=""

fail() {
  echo "teardown.sh: ${1}" >&2
  [ -n "${2:-}" ] && echo "  → ${2}" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance)    INSTANCE="${2:-}"; shift 2 ;;
    --archive-dir) ARCHIVE_DIR="${2:-}"; shift 2 ;;
    --no-archive)  ARCHIVE=0; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --yes)         ASSUME_YES=1; shift ;;
    *) fail "unknown flag: $1" "see the header of deploy/teardown.sh for usage" ;;
  esac
done
[ -n "${INSTANCE}" ] || fail "--instance is required" "e.g. ./deploy/teardown.sh --instance myalpha"
case "${INSTANCE}" in
  *[!a-z0-9-]* | -* | *- )
    fail "invalid --instance '${INSTANCE}'" "lowercase letters, digits and hyphens only" ;;
esac

# Preflight (real runs only): npx + an authenticated Cloudflare session, with a fix-it hint. The
# archive/delete steps would otherwise fail cryptically on the first wrangler call.
if [ "${DRY_RUN}" -eq 0 ]; then
  command -v npx >/dev/null 2>&1 || fail "required command not found: npx" \
    "install Node.js ≥ 20 — https://nodejs.org"
  npx wrangler whoami >/dev/null 2>&1 || fail "not authenticated to Cloudflare" \
    "run once: npx wrangler login   (or set CLOUDFLARE_API_TOKEN for CI)"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RES="alpha-gate-${INSTANCE}"
DEPLOY_DIR="${ROOT}/.deploy"
[ -n "${ARCHIVE_DIR}" ] || ARCHIVE_DIR="${DEPLOY_DIR}"
ARCHIVE_FILE="${ARCHIVE_DIR}/${INSTANCE}-$(date -u +%Y%m%dT%H%M%SZ).sql"

wrangler() {
  if [ "${DRY_RUN}" -eq 1 ]; then
    echo "[dry-run] wrangler $*" >&2
    return 0
  fi
  npx wrangler "$@"
}

if [ "${ASSUME_YES}" -eq 0 ] && [ "${DRY_RUN}" -eq 0 ]; then
  note="A D1 archive will be written first."
  [ "${ARCHIVE}" -eq 0 ] && note="No archive will be taken (--no-archive)."
  printf 'This permanently deletes instance "%s" (Workers, R2 bucket, D1 database). %s\nType the instance name to confirm: ' "${INSTANCE}" "${note}"
  read -r reply
  [ "${reply}" = "${INSTANCE}" ] || fail "aborted (the typed name did not match)"
fi

# Archive the database BEFORE destroying anything (it must still exist to export). Abort on failure so
# we never destroy without the backup the operator expects — they can opt out with --no-archive.
if [ "${ARCHIVE}" -eq 1 ]; then
  mkdir -p "${ARCHIVE_DIR}"
  echo "Archiving D1 -> ${ARCHIVE_FILE}"
  echo "  (full database dump — it contains LIVE access tokens; store it securely or delete it)"
  if ! wrangler d1 export "${RES}" --remote --output "${ARCHIVE_FILE}"; then
    fail "D1 export failed — nothing was destroyed" \
      "fix the error above, or re-run with --no-archive to destroy without a backup"
  fi
fi

wrangler delete --name "${RES}" || true
wrangler delete --name "${RES}-admin" || true

# An R2 bucket delete requires the bucket be empty, and pure wrangler has no way to list/empty it
# (no bulk-list API — that needs the S3 API + an API token, which this tool deliberately avoids). So a
# bucket holding build archives won't delete here; surface that loudly rather than orphaning it silently.
R2_LEFT=0
if ! wrangler r2 bucket delete "${RES}"; then
  R2_LEFT=1
fi

wrangler d1 delete "${RES}" --skip-confirmation || true

rm -f "${DEPLOY_DIR}/${INSTANCE}.app.toml" \
      "${DEPLOY_DIR}/${INSTANCE}.admin.toml" \
      "${DEPLOY_DIR}/${INSTANCE}.state.json"

echo
echo "Removed instance ${INSTANCE}: both Workers and the D1 database are deleted."
[ "${ARCHIVE}" -eq 1 ] && echo "Database archived to ${ARCHIVE_FILE} (contains live tokens — keep it safe)."
echo "Finish cleanup manually (pure wrangler can't):"
if [ "${R2_LEFT}" -eq 1 ]; then
  echo "  - R2 bucket '${RES}' was NOT deleted (non-empty). Empty it in the dashboard"
  echo "    (R2 -> ${RES} -> delete objects) or 'wrangler r2 object delete', then delete the bucket."
else
  echo "  - R2 bucket '${RES}' deleted (it was empty)."
fi
echo "  - Remove the Cloudflare Access application for '${RES}-admin' (Zero Trust -> Access -> Applications)."
