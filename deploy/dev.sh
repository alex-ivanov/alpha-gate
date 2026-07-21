#!/usr/bin/env bash
# Run Alpha Gate LOCALLY (§23 local surface) — Miniflare-backed D1 + R2, no Cloudflare account. Thin
# wrapper → the TypeScript CLI (src/deploy/cli.ts). By default it starts BOTH Workers so the whole
# system is live from one command: the App on :8787 and the gated admin on :8788 (the dev-only auth
# shim, src/dev/admin-entry.ts; DEV_ADMIN=1, never deployable).
#
#   ./deploy/dev.sh                       # both Workers (app :8787, admin :8788)
#   ./deploy/dev.sh --role app            # just the App Worker
#   ./deploy/dev.sh --role admin --port 8788   # just the admin
#   ./deploy/dev.sh --reset --no-seed     # flags pass through
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Run the local tsx binary DIRECTLY, not via `npx`: `npx` can stall on a registry round-trip, and
# running under npx/npm-exec makes the child `npx wrangler` a NESTED npm-exec that can deadlock on
# npm's lock — a silent hang where `wrangler dev` never binds. Fall back to `npx tsx` only when the
# local binary is missing (run `npm install`).
TSX="${ROOT}/node_modules/.bin/tsx"
CLI=(npx tsx "${ROOT}/src/deploy/cli.ts")
[ -x "${TSX}" ] && CLI=("${TSX}" "${ROOT}/src/deploy/cli.ts")

# A picked role (or --help) is a single-Worker run — hand straight to the CLI, unchanged behavior.
for arg in "$@"; do
  case "$arg" in
    --role|-h|--help) exec "${CLI[@]}" dev "$@" ;;
  esac
done

# Default: BOTH Workers. The app runs in the background (it shares Miniflare state via the state dir),
# the admin in the foreground so Ctrl-C stops the session. Derive the admin port as app_port+1.
APP_PORT=8787
for ((i=1; i<=$#; i++)); do
  if [ "${!i}" = "--port" ]; then j=$((i+1)); APP_PORT="${!j:-8787}"; fi
done
ADMIN_PORT=$((APP_PORT + 1))

echo "Starting BOTH Workers — App :${APP_PORT}, Admin :${ADMIN_PORT}. Ctrl-C stops both." >&2

# Shutdown: kill the background app CLI, then whatever is listening on our two ports (precisely our
# workerds — they re-parent to init so a process-tree walk can't reach them, but they hold the port).
# Best-effort: like the single-role path, wrangler can leave a workerd briefly orphaned; the CLI's
# start-time port-in-use guard catches any residual on the next run and tells you to `pkill -f workerd`.
"${CLI[@]}" dev "$@" &
APP_PID=$!
cleanup() {
  kill "${APP_PID}" 2>/dev/null || true
  for p in "${APP_PORT}" "${ADMIN_PORT}"; do
    for pid in $(lsof -ti tcp:"${p}" 2>/dev/null); do kill -9 "${pid}" 2>/dev/null || true; done
  done
}
trap cleanup EXIT INT TERM

# Give the app a moment to apply migrations/seed before the admin migrates the same DB (avoids a race
# on the shared SQLite file). Then the admin in the foreground — no --reset/--no-seed (already done).
sleep 4
"${CLI[@]}" dev --role admin --port "${ADMIN_PORT}"
