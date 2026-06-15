#!/usr/bin/env bash
# One-command publish of an already-signed, notarized **DMG** as the Sparkle update artifact (§20,
# decision 0003). macOS only. It mounts the DMG read-only, reads the app's version straight from its
# Info.plist (so you never retype it), produces the Sparkle EdDSA signature with `sign_update`, and hands
# the DMG to ci-publish.sh to upload + register. The Worker still never signs and never holds the key.
#
#   ./publish-dmg.sh MyApp.dmg --instance <slug> [--stream-id N] [--critical] [--dry-run]
#   ./publish-dmg.sh MyApp.dmg --admin-url https://alpha-gate-<slug>-admin.<acct>.workers.dev
#   ./publish-dmg.sh MyApp.dmg --instance <slug> --sign-update ./Sparkle/bin/sign_update
#
# The DMG is both the first-install download and the update enclosure: `/download` serves it with its
# filename, so Sparkle recognizes the .dmg and uses the disk-image installer. Sparkle 2 verifies the
# EdDSA, mounts, and installs the .app. Needs Sparkle's `sign_update` — on PATH, via --sign-update /
# $SIGN_UPDATE (its path is often inside the Sparkle package, not PATH), or bypass by passing ED_SIGNATURE.
#
# The Cloudflare Access service token is read from the macOS Keychain, keyed by instance — entered once
# on the first run for that instance (the script tells you how to create it), then reused automatically.
set -euo pipefail

DMG=""; INSTANCE=""; ADMIN_URL=""; STREAM_ID=""; CRITICAL_FLAG=""; DRY_RUN=0; RESET_TOKEN=0
SIGN_UPDATE="${SIGN_UPDATE:-}"   # path to Sparkle's sign_update; env default, --sign-update overrides
while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance)    INSTANCE="${2:-}"; shift 2 ;;
    --admin-url)   ADMIN_URL="${2:-}"; shift 2 ;;
    --stream-id)   STREAM_ID="${2:-}"; shift 2 ;;
    --sign-update) SIGN_UPDATE="${2:-}"; shift 2 ;;
    --critical)    CRITICAL_FLAG="--critical"; shift ;;
    --reset-token) RESET_TOKEN=1; shift ;;      # forget the stored service token and re-enter it
    --dry-run)     DRY_RUN=1; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 1 ;;
    *)  DMG="$1"; shift ;;          # the positional DMG path
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "${DMG}" ]    || { echo "usage: publish-dmg.sh <MyApp.dmg> (--instance <slug> | --admin-url <url>)" >&2; exit 1; }
[ -f "${DMG}" ]    || { echo "DMG not found: ${DMG}" >&2; exit 1; }

# Resolve the admin URL from the deploy state if not given (same mechanism as publish.sh; node has no
# extra cost — the deploy CLI already requires it).
if [ -z "${ADMIN_URL}" ] && [ -n "${INSTANCE}" ]; then
  STATE="${ROOT}/.deploy/${INSTANCE}.state.json"
  [ -f "${STATE}" ] || { echo "no deploy state for instance '${INSTANCE}'; pass --admin-url" >&2; exit 1; }
  ADMIN_URL="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).admin_url||""))' "${STATE}")"
fi
[ -n "${ADMIN_URL}" ] || { echo "--admin-url or --instance is required" >&2; exit 1; }

# ─── Cloudflare Access service token, from the macOS Keychain ──────────────────────────────────────
# The admin Worker is behind Access; reaching it from a script needs a service token. We keep it in the
# login Keychain keyed by instance (the host, if no --instance), so it's entered ONCE — not pasted into
# the shell or env each time. Resolution order: explicit env > Keychain > first-run prompt (then store).
# Skipped for a localhost admin (the §23 dev shim auto-authenticates) and for --dry-run (no side effects).
case "${ADMIN_URL}" in
  http://localhost*|http://127.0.0.1*|http://0.0.0.0*|"http://[::1]"*) LOCAL=1 ;;
  *) LOCAL=0 ;;
esac

if [ "${LOCAL}" -eq 0 ] && [ "${DRY_RUN}" -eq 0 ]; then
  KEY="${INSTANCE:-$(printf '%s' "${ADMIN_URL}" | sed -E 's#^https?://([^/]+).*#\1#')}"
  KC_SERVICE="alpha-gate-access"
  kc_get() { security find-generic-password -s "${KC_SERVICE}" -a "$1" -w 2>/dev/null || true; }

  if [ "${RESET_TOKEN}" -eq 1 ]; then
    security delete-generic-password -s "${KC_SERVICE}" -a "${KEY}-client-id"     >/dev/null 2>&1 || true
    security delete-generic-password -s "${KC_SERVICE}" -a "${KEY}-client-secret" >/dev/null 2>&1 || true
    CF_ACCESS_CLIENT_ID=""; CF_ACCESS_CLIENT_SECRET=""
    echo "Forgot the stored token for '${KEY}'; you'll be asked to enter it again." >&2
  fi

  FROM_KC=0
  if [ -z "${CF_ACCESS_CLIENT_ID:-}" ]; then
    CF_ACCESS_CLIENT_ID="$(kc_get "${KEY}-client-id")"; [ -n "${CF_ACCESS_CLIENT_ID}" ] && FROM_KC=1
  fi
  if [ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
    CF_ACCESS_CLIENT_SECRET="$(kc_get "${KEY}-client-secret")"; [ -n "${CF_ACCESS_CLIENT_SECRET}" ] && FROM_KC=1
  fi

  if [ -n "${CF_ACCESS_CLIENT_ID}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET}" ]; then
    [ "${FROM_KC}" -eq 1 ] && echo "Using stored Access service token for '${KEY}'." >&2
  elif [ -t 0 ]; then
    # First run for this instance: tell the operator how to create the token, then capture + store it.
    echo "" >&2
    echo "No Access service token stored for '${KEY}'. Create one:" >&2
    echo "  1. Cloudflare Zero Trust -> Access -> Service Auth -> 'Create service token'." >&2
    echo "  2. On the admin Access application, add a policy (Action: Service Auth) allowing it." >&2
    echo "  (The /admin/ci page documents this.) Then paste the credentials here:" >&2
    printf 'Service Token Client ID: ' >&2;     IFS= read -r CF_ACCESS_CLIENT_ID || true
    printf 'Service Token Client Secret: ' >&2; IFS= read -rs CF_ACCESS_CLIENT_SECRET || true; echo "" >&2
    [ -n "${CF_ACCESS_CLIENT_ID}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET}" ] \
      || { echo "both the client id and secret are required" >&2; exit 1; }
    security add-generic-password -U -s "${KC_SERVICE}" -a "${KEY}-client-id"     -w "${CF_ACCESS_CLIENT_ID}"     >/dev/null
    security add-generic-password -U -s "${KC_SERVICE}" -a "${KEY}-client-secret" -w "${CF_ACCESS_CLIENT_SECRET}" >/dev/null
    echo "Stored in your login Keychain (service '${KC_SERVICE}', account '${KEY}-*'); future runs read it automatically." >&2
  else
    echo "No service token stored for '${KEY}' and no TTY to prompt. Run once interactively to store it," >&2
    echo "or set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET in the environment." >&2
    exit 1
  fi
  export CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
fi

# ─── Read the app version from inside the DMG ─────────────────────────────────────────────────────
# Mount read-only with no UI, find the .app, read its Info.plist, then always detach (trap on exit).
MOUNTPOINT="$(mktemp -d)"
cleanup() { hdiutil detach "${MOUNTPOINT}" -quiet >/dev/null 2>&1 || true; rmdir "${MOUNTPOINT}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "${MOUNTPOINT}" "${DMG}" >/dev/null

APP="$(/bin/ls -d "${MOUNTPOINT}"/*.app 2>/dev/null | head -1 || true)"
[ -n "${APP}" ] || { echo "no .app found in ${DMG}" >&2; exit 1; }
PLIST="${APP}/Contents/Info"
SHORT_VERSION="${SHORT_VERSION:-$(defaults read "${PLIST}" CFBundleShortVersionString)}"
BUILD_NUMBER="${BUILD_NUMBER:-$(defaults read "${PLIST}" CFBundleVersion)}"
MIN_OS="${MIN_OS:-$(defaults read "${PLIST}" LSMinimumSystemVersion 2>/dev/null || true)}"

cleanup; trap - EXIT   # release the image before signing/uploading — neither needs it mounted
echo "read ${SHORT_VERSION} (build ${BUILD_NUMBER}${MIN_OS:+, min macOS ${MIN_OS}}) from ${DMG##*/}" >&2

# Sparkle's sparkle:version (= CFBundleVersion = build_number) must be a positive integer the resolver
# can compare; the server rejects anything else. Catch a non-integer CFBundleVersion before uploading.
case "${BUILD_NUMBER}" in
  ''|*[!0-9]*)
    echo "error: build number '${BUILD_NUMBER}' (the app's CFBundleVersion) is not a positive integer." >&2
    echo "       Sparkle compares sparkle:version numerically, so set CFBundleVersion to a monotonic" >&2
    echo "       integer (e.g. 3) — CFBundleShortVersionString stays your human version. Or pass" >&2
    echo "       BUILD_NUMBER=<n> to override for this publish." >&2
    exit 1 ;;
esac

# ─── Sparkle EdDSA signature over the DMG ─────────────────────────────────────────────────────────
# `sign_update` output differs by Sparkle version: newer prints `sparkle:edSignature="..." length="..."`,
# older prints the bare base64. Extract the signature value either way. Override the tool with
# --sign-update / $SIGN_UPDATE, or skip signing entirely by passing ED_SIGNATURE.
SIGN_BIN="${SIGN_UPDATE:-sign_update}"   # an explicit path, else expect it on PATH
if [ -z "${ED_SIGNATURE:-}" ]; then
  if command -v "${SIGN_BIN}" >/dev/null 2>&1; then
    SU_OUT="$("${SIGN_BIN}" "${DMG}")"
    ED_SIGNATURE="$(printf '%s' "${SU_OUT}" | sed -n 's/.*edSignature="\([^"]*\)".*/\1/p')"
    [ -n "${ED_SIGNATURE}" ] || ED_SIGNATURE="$(printf '%s' "${SU_OUT}" | tr -d '[:space:]')"
  elif [ "${DRY_RUN}" -eq 1 ]; then
    ED_SIGNATURE="DRY-RUN-SIGNATURE"   # let a dry run proceed without the Sparkle tool
  else
    echo "sign_update not found ('${SIGN_BIN}'). Pass --sign-update <path>, set \$SIGN_UPDATE, or ED_SIGNATURE." >&2
    exit 1
  fi
fi

# Hand off to the shared upload path. The DMG is the enclosure; ci-publish.sh streams it as-is.
PUBLISH_ARGS=(--admin-url "${ADMIN_URL}" --archive "${DMG}" \
  --short-version "${SHORT_VERSION}" --build-number "${BUILD_NUMBER}" --ed-signature "${ED_SIGNATURE}")
[ -n "${MIN_OS}" ]        && PUBLISH_ARGS+=(--min-os "${MIN_OS}")
[ -n "${CRITICAL_FLAG}" ] && PUBLISH_ARGS+=("${CRITICAL_FLAG}")
[ -n "${STREAM_ID}" ]     && PUBLISH_ARGS+=(--stream-id "${STREAM_ID}")
[ "${DRY_RUN}" -eq 1 ]    && PUBLISH_ARGS+=(--dry-run)

# Guard the Worker body cap (decision 0007): DMGs are often large. Over the ceiling → use the register
# path (PUT to R2 out of band, then ci-publish.sh --object-key/--size).
CEILING=$((90 * 1024 * 1024))
SIZE="$(wc -c < "${DMG}" | tr -d ' ')"
if [ "${SIZE}" -gt "${CEILING}" ]; then
  echo "DMG is ${SIZE} bytes (> 90 MB cap). PUT it to R2 as build/${BUILD_NUMBER}/${DMG##*/} and re-run" >&2
  echo "ci-publish.sh with --object-key build/${BUILD_NUMBER}/${DMG##*/} --size ${SIZE} (+ the args above)." >&2
  exit 1
fi

"${ROOT}/ci-publish.sh" "${PUBLISH_ARGS[@]}"
