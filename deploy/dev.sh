#!/usr/bin/env bash
# Run an Alpha Gate Worker LOCALLY (§23 local surface) — Miniflare-backed D1 + R2, no Cloudflare
# account. Thin wrapper → the TypeScript CLI (src/deploy/cli.ts). It renders a local config, applies
# migrations to a local DB, seeds a demo client/build, then starts `wrangler dev`. Same flags as before:
#
#   ./deploy/dev.sh [--role app|admin] [--port 8787] [--no-seed] [--reset]
#
# --role admin opens the gated UI at localhost/admin via the dev-only auth shim (src/dev/admin-entry.ts;
# DEV_ADMIN=1), never deployable. Roll back: `git log -- deploy/dev.sh`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec npx tsx "${ROOT}/src/deploy/cli.ts" dev "$@"
