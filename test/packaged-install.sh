#!/usr/bin/env bash
# The packaged-install smoke test: everything the unit suites CANNOT see.
#
# Both vitest suites run against the git checkout, where the source sits at the repo root. Users get
# the package under `node_modules`, and that one difference has already broken two things that every
# test passed straight through:
#
#   1. esbuild (inside wrangler) ignores a tsconfig.json under node_modules, so the hono/jsx transform
#      silently degraded to the classic one — every view compiled to `React.createElement`, the Worker
#      deployed clean, and the first request answered "ReferenceError: React is not defined".
#   2. npm hoists `tsx` beside the package rather than inside it, so the CLI's launcher could not find
#      it and died with `spawn tsx ENOENT` before doing anything.
#
# So this test builds the real artifact (`npm pack`), installs it into a throwaway consumer so the
# geometry is genuine, runs the CLI with the project's `.bin` kept OFF the PATH (npx would otherwise
# mask #2), and then bundles the installed Worker exactly as the CLI said it would — asserting on the
# emitted JavaScript, not on our intentions.
#
# Requires network (npm install + wrangler's bundler). Nothing here touches a Cloudflare account:
# every wrangler call is --dry-run. Run it from the repo root: ./test/packaged-install.sh
set -euo pipefail

cd "$(dirname "$0")/.." # npm pack packs the repo root, so run from there
# pwd -P: on macOS mktemp hands back /var/... while everything downstream resolves to /private/var/...,
# and the path comparison below would fail on the symlink alone.
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n\033[1m→ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
pass() { printf '\033[32m✓ %s\033[0m\n' "$1"; }

step "pack + install into a throwaway consumer"
TARBALL="$(npm pack --silent --pack-destination "$WORK")"
mkdir -p "$WORK/consumer"
cd "$WORK/consumer"
npm init -y >/dev/null 2>&1
npm install "$WORK/$TARBALL" --silent --no-audit --no-fund >/dev/null 2>&1
PKG="$WORK/consumer/node_modules/alpha-gate"
[ -d "$PKG" ] || fail "the package did not install"
[ -f "$PKG/tsconfig.json" ] || fail "tsconfig.json is missing from the tarball — the JSX transform depends on it being shipped"
pass "installed at node_modules/alpha-gate"

step "run the CLI with the project's .bin OFF the PATH"
# npx would put the hoisted node_modules/.bin on the PATH and hide a broken launcher. Keep node
# reachable (the shebang needs it) and nothing else from the consumer tree.
NODE_DIR="$(dirname "$(command -v node)")"
LOG="$WORK/dry-run.log"
if ! env -i HOME="$HOME" PATH="$NODE_DIR:/usr/bin:/bin" ALPHA_GATE_HOME="$WORK/state" \
	./node_modules/.bin/alpha-gate deploy --instance smoke --yes --dry-run >"$LOG" 2>&1; then
	cat "$LOG" >&2
	fail "the packaged CLI could not run (see above — 'spawn tsx ENOENT' means the launcher cannot find its runtime)"
fi
pass "the packaged CLI runs without PATH help"

step "read back the wrangler invocation the CLI intends"
# The dry-run echoes each command it would have run. Take the bundler flags from there rather than
# hardcoding them, so this test fails if the CLI ever stops passing them.
TSCONFIG_ARG="$(grep -o -- '--tsconfig [^ ]*' "$LOG" | head -1 | cut -d' ' -f2 || true)"
[ -n "$TSCONFIG_ARG" ] || fail "the CLI did not pass --tsconfig to wrangler deploy — the JSX transform will degrade to React.createElement"
[ "$TSCONFIG_ARG" = "$PKG/tsconfig.json" ] || fail "--tsconfig points at $TSCONFIG_ARG, not the installed package's own tsconfig ($PKG/tsconfig.json)"
pass "--tsconfig $TSCONFIG_ARG"

step "bundle the installed Worker and inspect the emitted JavaScript"
cat >"$WORK/smoke.toml" <<EOF
name = "alpha-gate-smoke"
main = "$PKG/src/worker.ts"
compatibility_date = "2025-01-01"

[vars]
INSTANCE = "smoke"
ROLE = "admin"
EMAIL_PROVIDER = "none"
EMAIL_FROM = ""
TOOL_VERSION = "0.0.0"
UPDATE_MANIFEST_URL = "https://example.test/release.json"
EOF
cd "$PKG"
npx wrangler deploy --config "$WORK/smoke.toml" --tsconfig "$TSCONFIG_ARG" \
	--dry-run --outdir "$WORK/out" >"$WORK/bundle.log" 2>&1 ||
	{ cat "$WORK/bundle.log" >&2; fail "bundling the installed Worker failed"; }

BUNDLE="$WORK/out/worker.js"
[ -f "$BUNDLE" ] || fail "no bundle was produced"

if grep -q "React.createElement" "$BUNDLE"; then
	fail "the bundle uses the CLASSIC JSX transform — every view calls React.createElement, nothing defines React, and the Worker will throw 'ReferenceError: React is not defined' on its first request"
fi
pass "no React.createElement"

# The positive half: proving the automatic hono/jsx runtime is what actually ran, so this test cannot
# pass just because the views vanished from the bundle.
JSX_CALLS="$(grep -c "jsxDEV\|jsxs\?(" "$BUNDLE" || true)"
[ "${JSX_CALLS:-0}" -gt 0 ] || fail "the bundle contains no hono/jsx runtime calls at all — the views did not make it in"
pass "$JSX_CALLS hono/jsx runtime calls"

printf '\n\033[32mPackaged install is sound.\033[0m\n'
