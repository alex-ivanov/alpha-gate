#!/usr/bin/env bash
# Provision and deploy one Alpha Gate instance (§19). Thin wrapper → the TypeScript deploy CLI
# (src/deploy/cli.ts), which replaced the hand-rolled bash orchestration: it shells out to wrangler
# with typed argv (no scraping/quoting surface), validates every command's output, is idempotent and
# resumable, and is unit-tested. The flags and UX are unchanged:
#
#   ./deploy/deploy.sh --instance <slug> [--app-name … --activate-scheme … --blurb … --accent …]
#                      [--access-team-domain … --access-aud …]
#                      [--email-provider none|cloudflare --email-from …] [--yes] [--dry-run]
#
# First init is guided (prompts for app config when interactive); Access is two-phase (it shows the
# dashboard step, waits, then collects the AUD). Requires `npm install` once (provides tsx + wrangler).
# To roll back to the previous pure-bash implementation: `git log -- deploy/deploy.sh`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Run the local tsx binary directly, not via `npx` (avoids a registry round-trip and a nested
# npm-exec deadlock when the CLI shells out to wrangler — see deploy/dev.sh). npx tsx is the fallback.
TSX="${ROOT}/node_modules/.bin/tsx"
[ -x "${TSX}" ] && exec "${TSX}" "${ROOT}/src/deploy/cli.ts" deploy "$@"
exec npx tsx "${ROOT}/src/deploy/cli.ts" deploy "$@"
