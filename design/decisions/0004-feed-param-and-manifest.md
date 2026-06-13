# 0004 — Installed-build feed param, and self-update manifest shape

**Status:** accepted (feed param) · proposed (manifest shape) · **Date:** 2026-06-13

## Installed-build feed parameter (§8)
§8 says the app sends its installed `build_number` to `/appcast` "as a feed parameter" but never names
it. This is a contract with the out-of-scope macOS/Sparkle app. It is **logging-only** — resolution
never needs the installed version — so blast radius is low.

**Decision:** the app appends **`&installed=<build_number>`** when it constructs the feed URL.
The Worker parses it **defensively** as an integer and records `NULL` if absent or non-numeric (never
errors). It also reads Sparkle's auto-appended `appVersion` and the `User-Agent` as opportunistic
fallbacks. Needed before M10 finalizes `/appcast` `check` logging.

## Self-update manifest shape (§22)
§22 defaults `UPDATE_MANIFEST_URL` to the repo's raw `release.json` (a `your-org` placeholder) and shows:

```json
{ "latest": "1.3.0", "min_supported": "1.1.0", "notes_url": "https://.../releases/1.3.0", "breaking": false }
```

**Proposed:** `core/version.isUpdateAvailable(toolVersion, manifest)` parses exactly
`{ latest: string, min_supported?: string, notes_url?: string, breaking?: boolean }` and tolerates extra
keys. **To ratify before any real deploy (M16/M17):** the real org/repo path. Non-blocking for tests —
the manifest fetch is mocked.
