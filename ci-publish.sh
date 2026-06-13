#!/usr/bin/env bash
# Portable publish: register an already-signed, notarized archive with a running Alpha Gate admin
# Worker, authenticating with a Cloudflare Access SERVICE TOKEN (no interactive login) — for CI (§20).
# It never builds or signs; that happens on macOS. Full upload for normal archives; for ones over the
# Worker body cap, PUT to R2 out of band and pass --object-key/--size (the register path, decision 0007).
set -euo pipefail

ADMIN_URL=""; ARCHIVE=""; SHORT_VERSION=""; BUILD_NUMBER=""; ED_SIGNATURE=""
STREAM_ID=""; MIN_OS=""; CRITICAL="false"; OBJECT_KEY=""; SIZE=""; DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --admin-url)     ADMIN_URL="${2:-}"; shift 2 ;;
    --archive)       ARCHIVE="${2:-}"; shift 2 ;;
    --short-version) SHORT_VERSION="${2:-}"; shift 2 ;;
    --build-number)  BUILD_NUMBER="${2:-}"; shift 2 ;;
    --ed-signature)  ED_SIGNATURE="${2:-}"; shift 2 ;;
    --stream-id)     STREAM_ID="${2:-}"; shift 2 ;;
    --min-os)        MIN_OS="${2:-}"; shift 2 ;;
    --critical)      CRITICAL="true"; shift ;;
    --object-key)    OBJECT_KEY="${2:-}"; shift 2 ;;
    --size)          SIZE="${2:-}"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

[ -n "${ADMIN_URL}" ]     || { echo "--admin-url is required" >&2; exit 1; }
[ -n "${SHORT_VERSION}" ] || { echo "--short-version is required" >&2; exit 1; }
[ -n "${BUILD_NUMBER}" ]  || { echo "--build-number is required" >&2; exit 1; }
[ -n "${ED_SIGNATURE}" ]  || { echo "--ed-signature is required" >&2; exit 1; }

if [ "${DRY_RUN}" -eq 1 ]; then
  CF_ACCESS_CLIENT_ID="${CF_ACCESS_CLIENT_ID:-dry-run-id}"
  CF_ACCESS_CLIENT_SECRET="${CF_ACCESS_CLIENT_SECRET:-dry-run-secret}"
else
  : "${CF_ACCESS_CLIENT_ID:?CF_ACCESS_CLIENT_ID env var is required}"
  : "${CF_ACCESS_CLIENT_SECRET:?CF_ACCESS_CLIENT_SECRET env var is required}"
fi

# post: the real curl adds the Access service-token headers; dry-run echoes the args WITHOUT the
# secret (the credentials are never expanded into the printed command).
post() {
  if [ "${DRY_RUN}" -eq 1 ]; then
    echo "[dry-run] curl -fsS -X POST -H 'CF-Access-Client-Id: <redacted>' -H 'CF-Access-Client-Secret: <redacted>' $*" >&2
    return 0
  fi
  curl -fsS -X POST \
    -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
    "$@"
}

if [ -n "${OBJECT_KEY}" ]; then
  # Register path: the archive is already in R2; send metadata only.
  [ -n "${SIZE}" ] || { echo "--size is required with --object-key" >&2; exit 1; }
  post \
    --data-urlencode "object_key=${OBJECT_KEY}" \
    --data-urlencode "size=${SIZE}" \
    --data-urlencode "short_version=${SHORT_VERSION}" \
    --data-urlencode "build_number=${BUILD_NUMBER}" \
    --data-urlencode "ed_signature=${ED_SIGNATURE}" \
    --data-urlencode "critical=${CRITICAL}" \
    ${MIN_OS:+--data-urlencode "min_os=${MIN_OS}"} \
    ${STREAM_ID:+--data-urlencode "stream_id=${STREAM_ID}"} \
    "${ADMIN_URL}/admin/builds/register"
else
  # Full upload path: stream the archive as multipart form data.
  [ -n "${ARCHIVE}" ] || { echo "--archive (or --object-key) is required" >&2; exit 1; }
  [ "${DRY_RUN}" -eq 1 ] || [ -f "${ARCHIVE}" ] || { echo "archive not found: ${ARCHIVE}" >&2; exit 1; }
  post \
    -F "archive=@${ARCHIVE}" \
    -F "short_version=${SHORT_VERSION}" \
    -F "build_number=${BUILD_NUMBER}" \
    -F "ed_signature=${ED_SIGNATURE}" \
    -F "critical=${CRITICAL}" \
    ${MIN_OS:+-F "min_os=${MIN_OS}"} \
    ${STREAM_ID:+-F "stream_id=${STREAM_ID}"} \
    "${ADMIN_URL}/admin/builds/upload"
fi

echo "published build ${BUILD_NUMBER} (${SHORT_VERSION}) to ${ADMIN_URL}"
