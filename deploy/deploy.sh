#!/usr/bin/env bash
# Provision and deploy one Alpha Gate instance (§19). Idempotent: re-run to update in place — D1/R2
# are reused, pending migrations applied, both Workers redeployed. Pure wrangler; no API token/DNS.
#
# First init is guided: anything not passed as a flag is prompted for (when run interactively), so a
# new instance comes up working almost immediately. Re-runs leave app config alone (the admin Settings
# page owns it) and are the place to wire Cloudflare Access once its application exists.
#
# Flags (all optional except --instance):
#   --instance <slug>              instance name (lowercase/digits/hyphens)
#   --app-name <name>              download-page app name        (first init → meta.app_name)
#   --activate-scheme <scheme>     macOS app URL scheme (§7)      (first init → meta.activate_scheme)
#   --blurb <text>                 download-page blurb            (first init → meta.blurb)
#   --accent <#hex>                accent colour                  (first init → meta.accent)
#   --access-team-domain <d>       e.g. team.cloudflareaccess.com (set as a secret + redeploy admin)
#   --access-aud <tag>             the Access application's AUD   (set as a secret + redeploy admin)
#   --email-provider none|cloudflare ; --email-from <addr>
#   --dry-run                      mock wrangler; exercise the whole flow offline (no prompts)
set -euo pipefail

INSTANCE=""
APP_NAME=""
ACTIVATE_SCHEME=""
BLURB=""
ACCENT=""
ACCESS_TEAM_DOMAIN=""
ACCESS_AUD=""
EMAIL_PROVIDER="none"
EMAIL_FROM=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance)            INSTANCE="${2:-}"; shift 2 ;;
    --app-name)            APP_NAME="${2:-}"; shift 2 ;;
    --activate-scheme)     ACTIVATE_SCHEME="${2:-}"; shift 2 ;;
    --blurb)               BLURB="${2:-}"; shift 2 ;;
    --accent)              ACCENT="${2:-}"; shift 2 ;;
    --access-team-domain)  ACCESS_TEAM_DOMAIN="${2:-}"; shift 2 ;;
    --access-aud)          ACCESS_AUD="${2:-}"; shift 2 ;;
    --email-provider)      EMAIL_PROVIDER="${2:-}"; shift 2 ;;
    --email-from)          EMAIL_FROM="${2:-}"; shift 2 ;;
    --dry-run)             DRY_RUN=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done
# Every check fails with a one-line reason plus a "→ what to do" remedy, so the user is never left
# guessing how to fix a missing prerequisite or bad flag.
fail() {
  echo "deploy.sh: ${1}" >&2
  [ -n "${2:-}" ] && echo "  → ${2}" >&2
  exit 1
}

[ -n "${INSTANCE}" ] || fail "--instance is required" "e.g. ./deploy/deploy.sh --instance myalpha"
# Validate the slug: it names resources, is interpolated into the rendered TOML, and is part of file
# paths. Restricting it to the Cloudflare naming charset also prevents config injection / path traversal.
case "${INSTANCE}" in
  *[!a-z0-9-]* | -* | *- )
    fail "invalid --instance '${INSTANCE}'" \
      "use lowercase letters, digits and hyphens only (no leading/trailing hyphen), e.g. 'myalpha'" ;;
esac

# Email config validation. Cloudflare delivery needs a verified From address on the onboarded sending
# domain; without one, invites/notifications would silently fail to send — so require it up front.
case "${EMAIL_PROVIDER}" in
  none|cloudflare) ;;
  *) fail "invalid --email-provider '${EMAIL_PROVIDER}'" "expected 'none' or 'cloudflare'" ;;
esac
if [ "${EMAIL_PROVIDER}" = "cloudflare" ] && [ -z "${EMAIL_FROM}" ]; then
  fail "--email-from is required when --email-provider is cloudflare" \
    "pass --email-from alpha@<your-onboarded-sending-domain>"
fi
# Access is all-or-nothing: a domain without an AUD (or vice versa) can't verify a token.
if { [ -n "${ACCESS_TEAM_DOMAIN}" ] && [ -z "${ACCESS_AUD}" ]; } ||
   { [ -z "${ACCESS_TEAM_DOMAIN}" ] && [ -n "${ACCESS_AUD}" ]; }; then
  fail "--access-team-domain and --access-aud must be provided together" \
    "find both in Cloudflare Zero Trust → Access → Applications → your app → Overview"
fi

# --- Preflight: verify the tooling and Cloudflare auth, telling the user exactly how to fix each gap.
# jq + envsubst are needed even in --dry-run (state render / config render); Node + wrangler auth only
# for a real deploy. Fail fast here rather than mid-run with a cryptic wrangler error.
need() {  # need <command> <how-to-install>
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1" "$2"
}
need jq "install jq — macOS: brew install jq · Debian/Ubuntu: sudo apt-get install -y jq · https://jqlang.github.io/jq/"
need envsubst "install GNU gettext (provides envsubst) — macOS: brew install gettext · Debian/Ubuntu: sudo apt-get install -y gettext-base"

if [ "${DRY_RUN}" -eq 0 ]; then
  need node "install Node.js ≥ 20 — https://nodejs.org (macOS: brew install node)"
  need npx "npx ships with Node.js ≥ 20 — reinstall Node from https://nodejs.org"
  NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
  case "${NODE_MAJOR}" in
    '' | *[!0-9]*) fail "could not read the Node.js version (node -v: $(node -v 2>/dev/null || echo none))" \
      "install Node.js ≥ 20 — https://nodejs.org" ;;
  esac
  [ "${NODE_MAJOR}" -ge 20 ] || fail "Node.js ≥ 20 is required (found $(node -v))" \
    "upgrade Node — https://nodejs.org or 'brew upgrade node'"
  # whoami exits non-zero when not logged in AND no valid CLOUDFLARE_API_TOKEN is set.
  npx wrangler whoami >/dev/null 2>&1 || fail "not authenticated to Cloudflare" \
    "run once: npx wrangler login   (opens a browser; for CI set CLOUDFLARE_API_TOKEN instead)"
  echo "Prerequisites OK — deploying to your authenticated Cloudflare account."
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "${ROOT}/deploy/wrangler.template.toml" ] || fail "missing deploy/wrangler.template.toml" \
  "run deploy.sh from a checkout of the Alpha Gate repository"
RES="alpha-gate-${INSTANCE}"
TOOL_VERSION="$(cat "${ROOT}/VERSION" 2>/dev/null || echo "0.0.0")"
UPDATE_MANIFEST_URL="${UPDATE_MANIFEST_URL:-https://raw.githubusercontent.com/your-org/alpha-gate/main/release.json}"
DEPLOY_DIR="${ROOT}/.deploy"
mkdir -p "${DEPLOY_DIR}"

# Interactive only when attached to a terminal and not rehearsing — so CI / --dry-run never blocks.
INTERACTIVE=0
if [ "${DRY_RUN}" -eq 0 ] && [ -t 0 ] && [ -r /dev/tty ]; then INTERACTIVE=1; fi

# Prompt for VARNAME if it's empty (i.e. not passed as a flag). Reads straight into the named variable
# (no eval), so values with spaces/quotes are safe. Falls back to the default on empty input / non-TTY.
ask() {
  local __var="$1" label="$2" def="$3"
  [ -n "${!__var}" ] && return 0
  if [ "${INTERACTIVE}" -eq 1 ]; then
    if [ -n "${def}" ]; then
      read -r -p "  ${label} [${def}]: " "${__var}" </dev/tty || true
    else
      read -r -p "  ${label}: " "${__var}" </dev/tty || true
    fi
  fi
  [ -n "${!__var}" ] || printf -v "${__var}" '%s' "${def}"
}

# wrangler wrapper: in --dry-run, echo the command instead of invoking the real CLI.
wrangler() {
  if [ "${DRY_RUN}" -eq 1 ]; then
    echo "[dry-run] wrangler $*" >&2
    return 0
  fi
  npx wrangler "$@"
}

# 1. D1 — create if absent, capture id, and note whether this is a first init (fresh database).
FRESH_DB=0
if [ "${DRY_RUN}" -eq 1 ]; then
  D1_ID="dry-run-d1-id"; FRESH_DB=1
else
  D1_ID="$(wrangler d1 list --json | jq -r --arg n "${RES}" '.[]|select(.name==$n)|.uuid' || true)"
  if [ -z "${D1_ID}" ] || [ "${D1_ID}" = "null" ]; then
    wrangler d1 create "${RES}" >/dev/null
    D1_ID="$(wrangler d1 list --json | jq -r --arg n "${RES}" '.[]|select(.name==$n)|.uuid')"
    FRESH_DB=1
  fi
fi

# 2. R2 — create if absent. Probe with `bucket info` (exit 0 iff it exists) rather than scraping
# `bucket list` output: the list format isn't a bare bucket-per-line, so the old grep never matched and
# a re-run tried to re-create the bucket — which errors ("already exists, and you own it") and aborts.
if [ "${DRY_RUN}" -eq 0 ]; then
  wrangler r2 bucket info "${RES}" >/dev/null 2>&1 || wrangler r2 bucket create "${RES}" >/dev/null
fi

# 3. Collect configuration. App identity/branding is seeded only on a FIRST init (the admin Settings
# page owns it afterwards, so re-runs must not clobber edits). Access credentials can be supplied on
# any run — typically the re-run after the Access application has been created.
if [ "${FRESH_DB}" -eq 1 ]; then
  [ "${INTERACTIVE}" -eq 1 ] && echo "Configuring new instance '${INSTANCE}' — press Enter to accept [defaults]:"
  ask APP_NAME        "App name"                          "Your App"
  ask ACTIVATE_SCHEME "Activate URL scheme (your app's)"  "myapp"
  ask BLURB           "Short blurb (optional)"            ""
  ask ACCENT          "Accent colour"                     "#0A84FF"
elif [ "${INTERACTIVE}" -eq 1 ]; then
  echo "Instance '${INSTANCE}' already exists — app name/branding are managed in the admin Settings page."
fi
# Access can be wired on any run via --access-team-domain/--access-aud. Otherwise, on an interactive
# re-run where it isn't configured yet, prompt for it — and DO NOT accept an empty value (the old
# blank-able prompt silently set nothing, leaving admin 403ing with no hint). A fresh first run can't
# do this (the Access app doesn't exist yet), so it's skipped there; the closing checklist guides it.
access_configured() {  # true if the admin Worker already has the ACCESS_TEAM_DOMAIN secret
  [ "${DRY_RUN}" -eq 1 ] && return 1
  npx wrangler secret list --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml" 2>/dev/null \
    | jq -e 'any(.[]?; .name == "ACCESS_TEAM_DOMAIN")' >/dev/null 2>&1
}
if [ "${FRESH_DB}" -eq 0 ] && [ "${INTERACTIVE}" -eq 1 ] && [ -z "${ACCESS_TEAM_DOMAIN}" ] \
   && ! access_configured; then
  echo "Cloudflare Access isn't wired yet — the admin UI returns 403 until it is. Where to find these:"
  echo "  • Team domain — Zero Trust → Settings (e.g. yourteam.cloudflareaccess.com; no https://)"
  echo "  • AUD tag     — Zero Trust → Access → Applications → your app → Overview"
  echo "  (Don't have them yet? Press Ctrl-C, finish the Access setup, then re-run.)"
  while [ -z "${ACCESS_TEAM_DOMAIN}" ]; do
    read -r -p "  Access team domain: " ACCESS_TEAM_DOMAIN </dev/tty || true
    [ -n "${ACCESS_TEAM_DOMAIN}" ] || echo "    (required — it can't be empty)"
  done
  while [ -z "${ACCESS_AUD}" ]; do
    read -r -p "  Access AUD tag: " ACCESS_AUD </dev/tty || true
    [ -n "${ACCESS_AUD}" ] || echo "    (required — it can't be empty)"
  done
fi
# Normalise a pasted team domain (strip scheme / trailing slash) so the issuer check can't silently
# fail on a value like "https://team.cloudflareaccess.com/".
if [ -n "${ACCESS_TEAM_DOMAIN}" ]; then
  ACCESS_TEAM_DOMAIN="${ACCESS_TEAM_DOMAIN#https://}"
  ACCESS_TEAM_DOMAIN="${ACCESS_TEAM_DOMAIN#http://}"
  ACCESS_TEAM_DOMAIN="${ACCESS_TEAM_DOMAIN%/}"
fi

# 4. Render the wrangler config for both roles from the one template. The Cloudflare Email Service
# binding is rendered ONLY for the admin Worker, and only when email delivery is on — the public app
# Worker never sends mail, so it must not carry (or be able to use) the send_email binding.
render() {
  role="$1"
  name="$2"
  if [ "${role}" = "admin" ] && [ "${EMAIL_PROVIDER}" = "cloudflare" ]; then
    SEND_EMAIL=$'[[send_email]]\nname = "EMAIL"'
  else
    SEND_EMAIL=""
  fi
  INSTANCE="${INSTANCE}" D1_ID="${D1_ID}" EMAIL_PROVIDER="${EMAIL_PROVIDER}" EMAIL_FROM="${EMAIL_FROM}" \
    ROLE="${role}" NAME="${name}" TOOL_VERSION="${TOOL_VERSION}" UPDATE_MANIFEST_URL="${UPDATE_MANIFEST_URL}" \
    SEND_EMAIL="${SEND_EMAIL}" \
    envsubst < "${ROOT}/deploy/wrangler.template.toml" > "${DEPLOY_DIR}/${INSTANCE}.${role}.toml"
}
render app "${RES}"
render admin "${RES}-admin"

# 5. Apply migrations once against the shared database.
wrangler d1 migrations apply "${RES}" --config "${DEPLOY_DIR}/${INSTANCE}.app.toml" --remote

# 6. First init only: seed the collected app config into `meta` (INSERT OR IGNORE never clobbers a
# value the admin later edits in Settings). The app validates activate_scheme at read time, so a typo
# safely falls back to the default rather than breaking the Activate link.
if [ "${FRESH_DB}" -eq 1 ]; then
  sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }
  SEED_SQL=""
  add_meta() {
    [ -n "$2" ] || return 0
    SEED_SQL="${SEED_SQL}INSERT OR IGNORE INTO meta (key, value) VALUES ('$1', '$(sql_escape "$2")');"
  }
  add_meta app_name "${APP_NAME}"
  add_meta activate_scheme "${ACTIVATE_SCHEME}"
  add_meta blurb "${BLURB}"
  add_meta accent "${ACCENT}"
  if [ -n "${SEED_SQL}" ]; then
    wrangler d1 execute "${RES}" --config "${DEPLOY_DIR}/${INSTANCE}.app.toml" --remote --command "${SEED_SQL}"
  fi
fi

# 7. Deploy both Workers and capture their URLs.
if [ "${DRY_RUN}" -eq 1 ]; then
  wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.app.toml"
  wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml"
  APP_URL="https://${RES}.<account>.workers.dev"
  ADM_URL="https://${RES}-admin.<account>.workers.dev"
else
  APP_URL="$(wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.app.toml" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -n1)"
  ADM_URL="$(wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -n1)"
fi

# 8. If Access credentials were supplied, set them as secrets and redeploy the admin Worker — this
# removes the manual `wrangler secret put` step. Secrets are piped on stdin (never echoed/logged).
ACCESS_SET=0
if [ -n "${ACCESS_TEAM_DOMAIN}" ] && [ -n "${ACCESS_AUD}" ]; then
  if [ "${DRY_RUN}" -eq 1 ]; then
    echo "[dry-run] set ACCESS_TEAM_DOMAIN + ACCESS_AUD secrets and redeploy admin" >&2
  else
    printf '%s' "${ACCESS_TEAM_DOMAIN}" | npx wrangler secret put ACCESS_TEAM_DOMAIN --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml"
    printf '%s' "${ACCESS_AUD}"         | npx wrangler secret put ACCESS_AUD         --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml"
    npx wrangler deploy --config "${DEPLOY_DIR}/${INSTANCE}.admin.toml" >/dev/null
  fi
  ACCESS_SET=1
fi

# 9. Persist state and print the remaining (genuinely manual) steps.
jq -n --arg i "${INSTANCE}" --arg a "${APP_URL}" --arg m "${ADM_URL}" --arg d "${D1_ID}" \
  '{instance:$i, app_url:$a, admin_url:$m, d1_id:$d}' > "${DEPLOY_DIR}/${INSTANCE}.state.json"

echo
echo "Deployed:"
echo "  App   (public) -> ${APP_URL}     # users + Sparkle"
echo "  Admin (gated)  -> ${ADM_URL}     # back office"
[ "${FRESH_DB}" -eq 1 ] && echo "  App config seeded: name='${APP_NAME}', activate scheme='${ACTIVATE_SCHEME}'."
echo

if [ "${ACCESS_SET}" -eq 1 ]; then
  cat <<EOF
Cloudflare Access secrets set on the admin Worker.
Remaining:
  - Ensure the Access application is enabled on "${RES}-admin" and your email is on its policy
    (Cloudflare Zero Trust -> Access -> Applications). The admin login is dead until it is.
  - Publish the first build (on macOS):  ./publish.sh --instance ${INSTANCE}

Note: if you ever RENAME your Zero Trust team, ACCESS_TEAM_DOMAIN changes and admin login will 403
until you re-run this script with the new --access-team-domain (and --access-aud if it changed too).
EOF
else
  cat <<EOF
Finish setup:
  1. Protect the admin Worker with Cloudflare Access (one-time, dashboard-only):
       Cloudflare Zero Trust -> Access -> Applications -> Add an application (Self-hosted),
       hostname = ${ADM_URL#https://}, add a policy allowing your email (one-time PIN).
     Then collect the two values the Worker verifies against:
       • Team domain — Zero Trust -> Settings  (e.g. yourteam.cloudflareaccess.com; no https://)
       • AUD tag     — Access -> Applications -> your app -> Overview
  2. Re-run to wire Access automatically (no manual secret-put):
       ./deploy/deploy.sh --instance ${INSTANCE} \\
         --access-team-domain yourteam.cloudflareaccess.com --access-aud <AUD>
  3. Publish the first build (on macOS):  ./publish.sh --instance ${INSTANCE}
  4. (optional) Email: upgrade to Workers Paid, onboard a sending domain, then re-run with
       --email-provider cloudflare --email-from alpha@<your-domain>

Note: if you later RENAME your Zero Trust team, the team domain changes — admin login will 403 until
you re-run with the new --access-team-domain.
EOF
fi
