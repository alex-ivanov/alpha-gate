#!/usr/bin/env bash
# Destroy one Alpha Gate instance (§21). Thin wrapper → the TypeScript CLI (src/deploy/cli.ts). By
# default it ARCHIVES the database first (wrangler d1 export to .deploy/<slug>-<ts>.sql); pass
# --no-archive to skip. Confirmed by typing the instance name (or --yes). Same flags/UX as before:
#
#   ./deploy/teardown.sh --instance <slug> [--no-archive] [--archive-dir <dir>] [--yes] [--dry-run]
#
# The R2 bucket (if non-empty) and the Cloudflare Access app are finished by hand — pure wrangler can't
# remove them; the CLI prints exactly what's left. Roll back: `git log -- deploy/teardown.sh`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec npx tsx "${ROOT}/src/deploy/cli.ts" teardown "$@"
