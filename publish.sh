#!/usr/bin/env bash
# ONE command to publish a signed, notarized macOS app to Alpha Gate. Give it the artifact:
#
#   ./publish.sh MyApp.dmg                       # into the only deployed instance, no channel
#   ./publish.sh MyApp.zip --channel beta        # a signed .app .zip, linked to a channel by NAME
#   ./publish.sh MyApp.dmg --instance myalpha --critical
#
# It reads the version straight from the app's Info.plist (never retype it), makes the Sparkle EdDSA
# signature with sign_update, and uploads. The Worker never signs and never holds the key. It handles
# BOTH artifact formats and the >90 MB register path itself, and pre-checks the build number against
# the running instance so you never fail after a multi-minute upload.
#
# What it needs on macOS: hdiutil (built in), Sparkle's sign_update (auto-found in Xcode's
# DerivedData, or pass --sign-update / $SIGN_UPDATE, or bypass with ED_SIGNATURE=<sig>). For a real
# instance it needs a Cloudflare Access service token — entered once, then stored in your Keychain.
#
# CI / headless: set CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET and pass --admin-url; on a runner
# with no app to read (already-built zip), pass --build-number/--short-version and ED_SIGNATURE.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARTIFACT=""; INSTANCE=""; ADMIN_URL=""; CHANNEL=""; STREAM_ID=""; CRITICAL_FLAG=""
DRY_RUN=0; RESET_TOKEN=0; BUILD_OVERRIDE=""; SHORT_OVERRIDE=""; MIN_OS_OVERRIDE=""
SIGN_UPDATE="${SIGN_UPDATE:-}"

need() { [ "$#" -ge 2 ] || { echo "missing value for $1" >&2; exit 1; }; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance)      need "$@"; INSTANCE="$2"; shift 2 ;;
    --admin-url)     need "$@"; ADMIN_URL="$2"; shift 2 ;;
    --channel)       need "$@"; CHANNEL="$2"; shift 2 ;;
    --stream-id)     need "$@"; STREAM_ID="$2"; shift 2 ;;    # legacy; --channel is preferred
    --sign-update)   need "$@"; SIGN_UPDATE="$2"; shift 2 ;;
    --build-number)  need "$@"; BUILD_OVERRIDE="$2"; shift 2 ;;
    --short-version) need "$@"; SHORT_OVERRIDE="$2"; shift 2 ;;
    --min-os)        need "$@"; MIN_OS_OVERRIDE="$2"; shift 2 ;;
    --critical)      CRITICAL_FLAG="true"; shift ;;
    --reset-token)   RESET_TOKEN=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 1 ;;
    *)  ARTIFACT="$1"; shift ;;
  esac
done

[ -n "${ARTIFACT}" ] || { echo "usage: ./publish.sh <MyApp.dmg|MyApp.zip> [--channel <name>] [--instance <slug>]" >&2; exit 1; }
[ -f "${ARTIFACT}" ] || { echo "artifact not found: ${ARTIFACT}" >&2; exit 1; }

# ─── Resolve the instance + admin URL ──────────────────────────────────────────────────────────────
# Default --instance when exactly one instance is deployed (its .deploy/<slug>.state.json). This makes
# the steady-state command './publish.sh MyApp.dmg' with no flags at all.
if [ -z "${ADMIN_URL}" ] && [ -z "${INSTANCE}" ]; then
  shopt -s nullglob
  STATES=("${ROOT}"/.deploy/*.state.json)
  shopt -u nullglob
  if [ "${#STATES[@]}" -eq 1 ]; then
    INSTANCE="$(basename "${STATES[0]}" .state.json)"
    echo "using the only deployed instance: ${INSTANCE}" >&2
  elif [ "${#STATES[@]}" -gt 1 ]; then
    echo "multiple instances deployed — pass --instance <slug>. Found:" >&2
    for s in "${STATES[@]}"; do echo "  $(basename "$s" .state.json)" >&2; done
    exit 1
  fi
fi
if [ -z "${ADMIN_URL}" ] && [ -n "${INSTANCE}" ]; then
  STATE="${ROOT}/.deploy/${INSTANCE}.state.json"
  [ -f "${STATE}" ] || { echo "no deploy state for instance '${INSTANCE}'; pass --admin-url" >&2; exit 1; }
  ADMIN_URL="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).admin_url||""))' "${STATE}" 2>/dev/null)" \
    || { echo "could not read admin_url from ${STATE}; pass --admin-url" >&2; exit 1; }
fi
[ -n "${ADMIN_URL}" ] || { echo "--admin-url or --instance is required" >&2; exit 1; }

case "${ADMIN_URL}" in
  http://localhost*|http://127.0.0.1*|http://0.0.0.0*|"http://[::1]"*) LOCAL=1 ;;
  *) LOCAL=0 ;;
esac

# ─── Cloudflare Access service token (Keychain, entered once) ───────────────────────────────────────
# The admin Worker is behind Access; reaching it needs a service token. Stored in the login Keychain
# keyed by instance/host. Skipped for a localhost dev admin (auto-authenticated) and for --dry-run.
if [ "${LOCAL}" -eq 0 ] && [ "${DRY_RUN}" -eq 0 ]; then
  KEY="${INSTANCE:-$(printf '%s' "${ADMIN_URL}" | sed -E 's#^https?://([^/]+).*#\1#')}"
  KC_SERVICE="alpha-gate-access"
  kc_get() { security find-generic-password -s "${KC_SERVICE}" -a "$1" -w 2>/dev/null || true; }
  if [ "${RESET_TOKEN}" -eq 1 ]; then
    security delete-generic-password -s "${KC_SERVICE}" -a "${KEY}-client-id"     >/dev/null 2>&1 || true
    security delete-generic-password -s "${KC_SERVICE}" -a "${KEY}-client-secret" >/dev/null 2>&1 || true
    CF_ACCESS_CLIENT_ID=""; CF_ACCESS_CLIENT_SECRET=""
    echo "Forgot the stored token for '${KEY}'." >&2
  fi
  [ -z "${CF_ACCESS_CLIENT_ID:-}" ]     && CF_ACCESS_CLIENT_ID="$(kc_get "${KEY}-client-id")"
  [ -z "${CF_ACCESS_CLIENT_SECRET:-}" ] && CF_ACCESS_CLIENT_SECRET="$(kc_get "${KEY}-client-secret")"
  if [ -n "${CF_ACCESS_CLIENT_ID}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET}" ]; then
    :
  elif [ -t 0 ]; then
    echo "" >&2
    echo "No Access service token stored for '${KEY}'. Create one (see the admin /admin/ci page):" >&2
    echo "  1. Cloudflare Zero Trust → Access → Service Auth → 'Create service token'." >&2
    echo "  2. On the admin Access application, add a policy (Action: Service Auth) allowing it." >&2
    printf 'Service Token Client ID: ' >&2;     IFS= read -r CF_ACCESS_CLIENT_ID || true
    printf 'Service Token Client Secret: ' >&2; IFS= read -rs CF_ACCESS_CLIENT_SECRET || true; echo "" >&2
    [ -n "${CF_ACCESS_CLIENT_ID}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET}" ] || { echo "both are required" >&2; exit 1; }
    security add-generic-password -U -s "${KC_SERVICE}" -a "${KEY}-client-id"     -w "${CF_ACCESS_CLIENT_ID}"     >/dev/null
    security add-generic-password -U -s "${KC_SERVICE}" -a "${KEY}-client-secret" -w "${CF_ACCESS_CLIENT_SECRET}" >/dev/null
    echo "Stored in your login Keychain; future runs read it automatically." >&2
  else
    echo "No service token for '${KEY}' and no TTY. Set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET." >&2
    exit 1
  fi
  export CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
fi

# curl with the Access headers (or dev-local defaults). We check the status ourselves because a
# rejected service token comes back as a 3xx redirect to the Access login, not a 4xx.
api() { # METHOD PATH [curl args…]  → body on stdout, returns nonzero on failure
  local method="$1" path="$2"; shift 2
  local id="${CF_ACCESS_CLIENT_ID:-dev-local}" secret="${CF_ACCESS_CLIENT_SECRET:-dev-local}"
  local body status
  body="$(mktemp)"
  status="$(curl -sS -o "${body}" -w '%{http_code}' -X "${method}" \
    -H "CF-Access-Client-Id: ${id}" -H "CF-Access-Client-Secret: ${secret}" \
    "$@" "${ADMIN_URL}${path}")" || { echo "could not reach ${ADMIN_URL} (network error)" >&2; rm -f "${body}"; return 1; }
  if [ "${status}" -ge 200 ] && [ "${status}" -lt 300 ]; then cat "${body}"; rm -f "${body}"; return 0; fi
  echo "request failed: HTTP ${status}" >&2
  if [ "${status}" -ge 300 ] && [ "${status}" -lt 400 ]; then
    echo "  Cloudflare Access rejected the service token. Confirm the token + a Service-Auth policy" >&2
    echo "  on the admin Access app (see /admin/ci), or re-enter: ./publish.sh … --reset-token." >&2
  else
    sed 's/^/  /' "${body}" >&2
  fi
  rm -f "${body}"; return 1
}

# ─── Read version + min-OS from the app inside the artifact ─────────────────────────────────────────
# One helper reads an Info.plist with PlistBuddy (not `defaults`, which caches). DMGs are mounted;
# zips are read with unzip -p through plutil. Overrides (flags/env) beat what we read.
SHORT_VERSION=""; BUILD_NUMBER=""; MIN_OS=""
pb() { /usr/libexec/PlistBuddy -c "Print :$1" "$2" 2>/dev/null || true; }

read_from_plist() { # PLIST_PATH
  SHORT_VERSION="${SHORT_OVERRIDE:-${SHORT_VERSION:-$(pb CFBundleShortVersionString "$1")}}"
  BUILD_NUMBER="${BUILD_OVERRIDE:-${BUILD_NUMBER:-$(pb CFBundleVersion "$1")}}"
  MIN_OS="${MIN_OS_OVERRIDE:-${MIN_OS:-$(pb LSMinimumSystemVersion "$1")}}"
}

case "${ARTIFACT##*.}" in
  dmg)
    ATTACH="$(hdiutil attach "${ARTIFACT}" -nobrowse -readonly -noautoopen -mountrandom /tmp 2>&1)" \
      || { echo "could not mount ${ARTIFACT}:" >&2; printf '%s\n' "${ATTACH}" | sed 's/^/  /' >&2; exit 1; }
    DEV="$(printf '%s\n' "${ATTACH}" | grep -Eo '^/dev/disk[0-9]+' | head -1 || true)"
    MOUNTS="$(printf '%s\n' "${ATTACH}" | grep -Eo '/tmp/[^[:space:]]+' || true)"
    cleanup() {
      [ -n "${DEV:-}" ] && hdiutil detach "${DEV}" -quiet >/dev/null 2>&1 || true
      for m in ${MOUNTS:-}; do hdiutil detach "${m}" -quiet >/dev/null 2>&1 || true; done
    }
    trap cleanup EXIT INT TERM
    APP=""
    for M in ${MOUNTS:-}; do
      A="$(/bin/ls -d "${M}"/*.app 2>/dev/null | head -1 || true)"
      [ -n "${A}" ] && { APP="${A}"; break; }
    done
    [ -n "${APP}" ] || { echo "no .app found in ${ARTIFACT}" >&2; exit 1; }
    if [ -L "${APP}" ]; then
      echo "error: '${APP##*/}' in the DMG is a symlink → $(readlink "${APP}"); its version would come" >&2
      echo "       from the link target, not the DMG. Rebuild it, or pass --build-number/--short-version." >&2
      exit 1
    fi
    PLIST="${APP}/Contents/Info.plist"
    [ -f "${PLIST}" ] || { echo "no Info.plist in ${APP##*/}" >&2; exit 1; }
    read_from_plist "${PLIST}"
    cleanup; trap - EXIT INT TERM   # release before signing/uploading — neither needs it mounted
    ;;
  zip)
    # A signed .app .zip: find the Info.plist inside and read it via a temp copy (PlistBuddy needs a
    # file). If the zip has no readable .app plist, the operator must pass the version flags.
    PLIST_ENTRY="$(unzip -Z1 "${ARTIFACT}" 2>/dev/null | grep -E '\.app/Contents/Info\.plist$' | head -1 || true)"
    if [ -n "${PLIST_ENTRY}" ]; then
      TMP_PLIST="$(mktemp)"
      if unzip -p "${ARTIFACT}" "${PLIST_ENTRY}" > "${TMP_PLIST}" 2>/dev/null && [ -s "${TMP_PLIST}" ]; then
        plutil -convert xml1 "${TMP_PLIST}" >/dev/null 2>&1 || true
        read_from_plist "${TMP_PLIST}"
      fi
      rm -f "${TMP_PLIST}"
    fi
    ;;
  *)
    # Any other extension (e.g. .tar): can't read a plist — require the version flags.
    : ;;
esac

# Fall back to overrides for formats we couldn't read.
SHORT_VERSION="${SHORT_OVERRIDE:-${SHORT_VERSION}}"
BUILD_NUMBER="${BUILD_OVERRIDE:-${BUILD_NUMBER}}"
MIN_OS="${MIN_OS_OVERRIDE:-${MIN_OS}}"
[ -n "${SHORT_VERSION}" ] || { echo "could not read the short version; pass --short-version" >&2; exit 1; }
[ -n "${BUILD_NUMBER}" ]  || { echo "could not read the build number; pass --build-number" >&2; exit 1; }
echo "read ${SHORT_VERSION} (build ${BUILD_NUMBER}${MIN_OS:+, min macOS ${MIN_OS}}) from ${ARTIFACT##*/}" >&2

# Sparkle compares CFBundleVersion (= build_number) numerically; the server rejects non-integers.
case "${BUILD_NUMBER}" in
  ''|*[!0-9]*)
    echo "error: build number '${BUILD_NUMBER}' (CFBundleVersion) is not a positive integer." >&2
    echo "       Set CFBundleVersion to a monotonic integer, or pass --build-number <n>." >&2
    exit 1 ;;
esac

# ─── Pre-flight against the running instance (publish-info): catch a duplicate/typo BEFORE signing ──
if [ "${DRY_RUN}" -eq 0 ]; then
  INFO="$(api GET /admin/publish-info || true)"
  if [ -n "${INFO}" ]; then
    TOP="$(printf '%s' "${INFO}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).topBuild??""))}catch{}})' 2>/dev/null || true)"
    if [ -n "${TOP}" ] && [ "${BUILD_NUMBER}" -le "${TOP}" ] 2>/dev/null; then
      echo "error: build number ${BUILD_NUMBER} is not above the current highest (${TOP})." >&2
      echo "       Each build must increase — use $((TOP + 1)) or higher." >&2
      exit 1
    fi
    if [ -n "${CHANNEL}" ]; then
      NAMES="$(printf '%s' "${INFO}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=(JSON.parse(s).channels||[]).map(x=>x.name);process.stdout.write(c.join(", "))}catch{}})' 2>/dev/null || true)"
      case ", ${NAMES}," in
        *", ${CHANNEL},"*) : ;;
        *)
          echo "error: channel '${CHANNEL}' does not exist on this instance." >&2
          echo "       Existing channels: ${NAMES:-(none)}" >&2
          exit 1 ;;
      esac
    fi
  fi
fi

# ─── Sparkle EdDSA signature ────────────────────────────────────────────────────────────────────────
find_sign_update() {
  [ -n "${SIGN_UPDATE}" ] && { printf '%s' "${SIGN_UPDATE}"; return; }
  command -v sign_update >/dev/null 2>&1 && { printf 'sign_update'; return; }
  # Sparkle SPM builds land its tools under Xcode DerivedData; find the newest.
  local dd="${HOME}/Library/Developer/Xcode/DerivedData"
  [ -d "${dd}" ] && find "${dd}" -type f -name sign_update -path '*/artifacts/*' \
    -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-
}

if [ -z "${ED_SIGNATURE:-}" ]; then
  SIGN_BIN="$(find_sign_update)"
  if [ -n "${SIGN_BIN}" ] && { [ "${SIGN_BIN}" = "sign_update" ] || [ -x "${SIGN_BIN}" ]; }; then
    echo "signing with ${SIGN_BIN}" >&2
    SU_OUT="$("${SIGN_BIN}" "${ARTIFACT}")"
    ED_SIGNATURE="$(printf '%s' "${SU_OUT}" | sed -n 's/.*edSignature="\([^"]*\)".*/\1/p')"
    [ -n "${ED_SIGNATURE}" ] || ED_SIGNATURE="$(printf '%s' "${SU_OUT}" | tr -d '[:space:]')"
  elif [ "${DRY_RUN}" -eq 1 ]; then
    ED_SIGNATURE="DRY-RUN-SIGNATURE"
  else
    echo "sign_update not found. Pass --sign-update <path>, set \$SIGN_UPDATE, or ED_SIGNATURE=<sig>." >&2
    echo "  (Sparkle ships it inside the package; SPM builds put it under Xcode DerivedData.)" >&2
    exit 1
  fi
fi

# ─── Upload (or register for >90 MB) ────────────────────────────────────────────────────────────────
SIZE="$(wc -c < "${ARTIFACT}" | tr -d ' ')"
CEILING=$((90 * 1024 * 1024))
FILENAME="${ARTIFACT##*/}"

common_fields=(
  --data-urlencode "short_version=${SHORT_VERSION}"
  --data-urlencode "build_number=${BUILD_NUMBER}"
  --data-urlencode "ed_signature=${ED_SIGNATURE}"
)
[ -n "${MIN_OS}" ]         && common_fields+=(--data-urlencode "min_os=${MIN_OS}")
[ -n "${CRITICAL_FLAG}" ]  && common_fields+=(--data-urlencode "critical=true")
[ -n "${CHANNEL}" ]        && common_fields+=(--data-urlencode "channel=${CHANNEL}")
[ -n "${STREAM_ID}" ]      && common_fields+=(--data-urlencode "stream_id=${STREAM_ID}")

if [ "${DRY_RUN}" -eq 1 ]; then
  echo "[dry-run] would publish build ${BUILD_NUMBER} (${SHORT_VERSION})${CHANNEL:+ → channel ${CHANNEL}} to ${ADMIN_URL}" >&2
  exit 0
fi

if [ "${SIZE}" -le "${CEILING}" ]; then
  # Full upload: multipart. -F for the file, the metadata fields converted to -F.
  up=(-F "archive=@${ARTIFACT}")
  for ((i=0; i<${#common_fields[@]}; i+=2)); do up+=(-F "${common_fields[$((i+1))]}"); done
  api POST /admin/builds/upload "${up[@]}" >/dev/null
else
  # Over the Worker body cap: PUT to R2 with the operator's OWN wrangler auth (no extra token), then
  # register metadata-only. This removes the old manual two-step for large DMGs.
  echo "artifact is ${SIZE} bytes (> 90 MB) — uploading to R2 with wrangler, then registering." >&2
  OBJECT_KEY="build/${BUILD_NUMBER}/${FILENAME}"
  BUCKET="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(s.bucket||("alpha-gate-"+(process.argv[2]||"")))' "${ROOT}/.deploy/${INSTANCE}.state.json" "${INSTANCE}" 2>/dev/null || echo "alpha-gate-${INSTANCE}")"
  ( cd "${ROOT}" && npx wrangler r2 object put "${BUCKET}/${OBJECT_KEY}" --file "${ARTIFACT}" --remote ) \
    || { echo "wrangler R2 upload failed" >&2; exit 1; }
  api POST /admin/builds/register \
    --data-urlencode "object_key=${OBJECT_KEY}" --data-urlencode "size=${SIZE}" \
    "${common_fields[@]}" >/dev/null
fi

echo "✓ published build ${BUILD_NUMBER} (${SHORT_VERSION})${CHANNEL:+ → ${CHANNEL}} to ${ADMIN_URL}"
