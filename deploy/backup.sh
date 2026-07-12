#!/usr/bin/env bash
# Back up an Alpha Gate instance's D1 database to a timestamped .sql dump — the same export teardown
# takes before destroying, minus the destruction. Run it on a schedule (cron/launchd) or before a
# risky change. R2 archives are NOT included: they're large and re-uploadable by re-publishing; this
# captures the irreplaceable state (clients + their tokens, builds, channels, logs, audit chain).
#
#   ./deploy/backup.sh --instance myalpha [--out ./backups]
#
# The dump contains LIVE per-user tokens — store it somewhere private (NOT the repo) and delete old
# copies. Restore into a fresh instance:  wrangler d1 execute <db> --remote --file <dump>.sql
# (see docs/ONBOARDING.md → Backup & recovery).
set -euo pipefail

INSTANCE=""; OUT=""
need() { [ "$#" -ge 2 ] || { echo "missing value for $1" >&2; exit 1; }; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance) need "$@"; INSTANCE="$2"; shift 2 ;;
    --out)      need "$@"; OUT="$2"; shift 2 ;;
    -h|--help)  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done
[ -n "${INSTANCE}" ] || { echo "usage: ./deploy/backup.sh --instance <slug> [--out <dir>]" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=deploy/lib/statedir.sh
. "${ROOT}/deploy/lib/statedir.sh"
RES="alpha-gate-${INSTANCE}"
OUT="${OUT:-$(alpha_gate_state_dir "${ROOT}")}"
mkdir -p "${OUT}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="${OUT}/${INSTANCE}-${STAMP}.sql"

echo "Exporting ${RES} → ${FILE} (this reads the REMOTE database)…" >&2
if npx wrangler d1 export "${RES}" --remote --output "${FILE}"; then
  BYTES="$(wc -c < "${FILE}" | tr -d ' ')"
  echo "✓ backed up ${BYTES} bytes to ${FILE}" >&2
  echo "  This dump contains live tokens — keep it private and prune old copies." >&2
  echo "${FILE}"
else
  echo "backup failed — is wrangler logged in (npx wrangler login) and is '${INSTANCE}' deployed?" >&2
  rm -f "${FILE}"
  exit 1
fi
