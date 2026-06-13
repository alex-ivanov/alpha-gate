# 0007 — Large-build upload boundary

**Status:** accepted · **Date:** 2026-06-13

## Context
§20 says "for archives that exceed the Worker request-size limit, upload the binary straight to R2 and
call a metadata-only register variant"; §13 notes the browser upload is "subject to the request-size
limit". The actual limit, threshold, and register endpoint shape are open. macOS `.app` archives can
exceed the cap, and a partial/oversized upload that registers a build whose R2 length ≠ declared length
would break Sparkle updates for **every** client.

## Decision
Cloudflare Workers request-body cap is **100 MB** on Free/Pro (over it → 413). Implement both modes on
the one endpoint family:
- **Full upload** `POST /admin/builds/upload` — stream the request body to R2 for builds under a
  conservative **~90 MB** ceiling. Reject early with a clear 413 when `Content-Length` exceeds the ceiling.
- **Register** `POST /admin/builds/register` — takes `object_key` + `size` + `ed_signature` + version
  metadata for an artifact already PUT to R2 out-of-band (a scoped Cloudflare API token with R2 write —
  a CI/operator concern, not the Worker's). Before inserting the `builds` row, **HEAD the R2 object and
  assert its actual size == the declared length** (a wrong length poisons updates for everyone).
- **`publish.sh` auto-selects** the path by file size, so a solo dev never hits a 413.

## Consequences
- Service-token auth is accepted only on these two routes (decision 0006).
- Tests: size-ceiling rejection (clean 413) and register length-mismatch rejection (no row inserted).
