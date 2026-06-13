# 0008 — Informational appcast item version

**Status:** accepted · **Date:** 2026-06-13

## Context
§15 says the revoked/unknown `/appcast` response is an **informational-only** item with "a higher
`sparkle:version`" so Sparkle shows a notice (a `<link>` to the access page, **no enclosure**, hence no
Install button). The doc does not say higher than *what*, or what value to use.

## Decision
Use a **fixed large sentinel** `sparkle:version = 999000000` (comfortably below INT32 max to avoid
overflow, far above any plausible real `build_number`) combined with **no enclosure**. Because there is
no enclosure, Sparkle cannot install it regardless of the number, so a permanent sentinel is safe and
avoids a DB query on the revoked path. Keep it as a named constant `INFORMATIONAL_SENTINEL_VERSION` in
`core/appcast.ts`.

## Consequences
- Do **not** derive the value from the caller's installed version (the background-check path may not
  report one reliably — decision 0004).
- Document the real-`build_number` ceiling so a real build can never reach the sentinel.
