#!/usr/bin/env bash
# Local macOS publish (§20): build -> sign (Developer ID) -> notarize -> staple -> archive ->
# sign_update (Sparkle EdDSA), then hand off to ci-publish.sh to upload + register. The Worker never
# signs and never holds the EdDSA key. The build/sign block is app-specific — fill in the marked
# commands for your project; everything below the line is generic. macOS only.
set -euo pipefail

INSTANCE=""; ADMIN_URL=""; STREAM_ID=""; CRITICAL_FLAG=""; DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --instance)  INSTANCE="${2:-}"; shift 2 ;;
    --admin-url) ADMIN_URL="${2:-}"; shift 2 ;;
    --stream-id) STREAM_ID="${2:-}"; shift 2 ;;
    --critical)  CRITICAL_FLAG="--critical"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve the admin URL from the deploy state if not given explicitly. Read with node (already required
# by the deploy CLI) so publish.sh has no extra dependency; a missing field yields "" (caught below).
if [ -z "${ADMIN_URL}" ] && [ -n "${INSTANCE}" ]; then
  STATE="${ROOT}/.deploy/${INSTANCE}.state.json"
  [ -f "${STATE}" ] || { echo "no deploy state for instance '${INSTANCE}'; pass --admin-url" >&2; exit 1; }
  ADMIN_URL="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).admin_url||""))' "${STATE}")"
fi
[ -n "${ADMIN_URL}" ] || { echo "--admin-url or --instance is required" >&2; exit 1; }

# ─── APP-SPECIFIC: produce the signed, notarized archive ──────────────────────────────────────────
# Replace these with your project's real build. The result must set ARCHIVE / SHORT_VERSION /
# BUILD_NUMBER / ED_SIGNATURE. Example shape:
#   xcodebuild -scheme MyApp -configuration Release -derivedDataPath build archive ...
#   codesign --deep --options runtime --sign "Developer ID Application: ..." build/MyApp.app
#   ditto -c -k --keepParent build/MyApp.app dist/MyApp.zip
#   xcrun notarytool submit dist/MyApp.zip --keychain-profile NOTARY --wait
#   xcrun stapler staple build/MyApp.app
#   ED_SIGNATURE="$(sign_update dist/MyApp.zip)"   # Sparkle's tool; prints sparkle:edSignature
ARCHIVE="${ARCHIVE:-dist/MyApp.zip}"
SHORT_VERSION="${SHORT_VERSION:-$(defaults read "$(pwd)/build/MyApp.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "0.0.0")}"
BUILD_NUMBER="${BUILD_NUMBER:-$(defaults read "$(pwd)/build/MyApp.app/Contents/Info" CFBundleVersion 2>/dev/null || echo "1")}"
ED_SIGNATURE="${ED_SIGNATURE:-PLACEHOLDER_RUN_sign_update}"
# ──────────────────────────────────────────────────────────────────────────────────────────────────

# Auto-select full upload vs the register path by size so a solo dev never hits the 100 MB body cap.
CEILING=$((90 * 1024 * 1024))
SIZE=0
[ -f "${ARCHIVE}" ] && SIZE="$(wc -c < "${ARCHIVE}" | tr -d ' ')"

PUBLISH_ARGS=(--admin-url "${ADMIN_URL}" --short-version "${SHORT_VERSION}" \
  --build-number "${BUILD_NUMBER}" --ed-signature "${ED_SIGNATURE}")
[ -n "${CRITICAL_FLAG}" ] && PUBLISH_ARGS+=("${CRITICAL_FLAG}")
[ -n "${STREAM_ID}" ] && PUBLISH_ARGS+=(--stream-id "${STREAM_ID}")
[ "${DRY_RUN}" -eq 1 ] && PUBLISH_ARGS+=(--dry-run)

if [ "${SIZE}" -gt "${CEILING}" ]; then
  echo "Archive is ${SIZE} bytes (> ceiling). PUT it to R2 out of band, then re-run ci-publish.sh" >&2
  echo "with --object-key build/${BUILD_NUMBER}/$(basename "${ARCHIVE}") --size ${SIZE}." >&2
  exit 1
fi

"${ROOT}/ci-publish.sh" "${PUBLISH_ARGS[@]}" --archive "${ARCHIVE}"
