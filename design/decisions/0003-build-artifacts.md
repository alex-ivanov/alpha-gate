# 0003 — Build artifacts (DMG + zip) and R2 key layout

**Status:** accepted · **Date:** 2026-06-13

## Context
§2/§7/§20 imply each build has **two** artifacts — a DMG for first install, and the EdDSA-signed `.app`
zip Sparkle consumes — but the §5 `builds` table has exactly one `object_key` / `ed_signature` / `length`.
§5/§6/§16 say branding images live under `branding/` served at `/assets/<name>`, and build objects are
append-only, but never give the exact key template.

## Decision
- **Two artifacts per build.** Add migration **`0006`** extending `builds` with nullable
  `dmg_object_key` and `dmg_length`. The existing `object_key`/`ed_signature`/`length` always describe
  the **signed zip** (the Sparkle enclosure). The DMG carries **no EdDSA** — notarization/Gatekeeper seal
  it and Sparkle never touches it.
- **`/download` resolution:** `via=update` → the signed zip (the appcast enclosure). `via=install` →
  the DMG if present, else the zip.
- The appcast enclosure `length`/`type` always match the **zip** exactly (keeps §14 intact).
- **R2 key layout** (centralized in `r2/keys.ts`, the only place keys are built):
  - Archives: `build/<build_number>/<sanitized-original-filename>` — append-only (`build_number` is
    UNIQUE), self-describing, lets the DMG + zip for one build coexist under one prefix.
  - Branding: the doc's literal `branding/icon` and `branding/header`; served at `/assets/*` with a
    cache-busting version derived from the asset's content hash stored in `meta`.
  - Audit anchor: an append-only head object (decision 0005 / §16).

## Consequences
- M0 writes 6 migrations, not 5. M9's `/download` branches on `via=`. M15's upload accepts up to two
  artifacts.
- Alternative deferred: a one-artifact MVP (same zip for install + update). Rejected here in favor of the
  doc's DMG-first-install UX; the two-artifact path is a small, additive schema change.

## Amendment (2026-06-14) — the enclosure is format-agnostic; a DMG can be the update artifact

The "the enclosure is always the zip" framing above is about the *common* path, not a constraint. Nothing
in the resolver, appcast, or download is zip-specific: the appcast `<enclosure type>` is
`application/octet-stream`, the enclosure URL is the extension-less `/download?token=…&via=update`, and
`/download` already sets `Content-Disposition: filename="<object-key basename>"` (`sanitizeFilename`
preserves the extension). So a **single signed `.dmg`** can serve as both the first-install download and
the Sparkle **update** enclosure: Sparkle 2 verifies the EdDSA, sees the `.dmg` name from the
Content-Disposition, and uses the disk-image installer. In that mode `object_key` is the `.dmg`,
`dmg_object_key` stays null, and `via=install`/`via=update` both stream the one artifact.

Driven by `publish-dmg.sh` (§20): mount the DMG read-only, read `CFBundleShortVersionString` /
`CFBundleVersion` / `LSMinimumSystemVersion` from the app's `Info.plist`, `sign_update` the DMG for the
EdDSA, and upload it via `ci-publish.sh`. Covered by `test/integration/routes/dmg-enclosure.test.ts`. The
EdDSA over the DMG is still produced on macOS — the Worker never signs.
