# 0011 — Richer, editable reactivation notice (hide the sentinel version)

**Status:** accepted · **Date:** 2026-06-14

## Context
The §15 reactivation notice (decisions 0008/0010, shown to **revoked/unknown** tokens) was a bare item:
`<title>Reactivate your access</title>`, `<sparkle:version>999000000</sparkle:version>`, `<link>`.
With no `sparkle:shortVersionString`, Sparkle displays the raw `sparkle:version` — so the user sees a
dialog offering version **"999000000"**, which looks broken, and there is no message explaining what to
do. (Reported from a live instance.)

Sparkle facts (verified against sparkle-project.org/documentation/publishing):
- `sparkle:version` is the machine-comparable key; **`sparkle:shortVersionString` is what the dialog
  displays.** Provide it and the sentinel number never shows.
- An item is informational (a notice, no Install button) when it has no `<enclosure>`. Sparkle 2 also
  has an explicit marker: an **empty `<sparkle:informationalUpdate></sparkle:informationalUpdate>`**
  means "informational for all versions"; Sparkle 1.x ignores the element and falls back to the
  no-enclosure rule. So adding it is strictly better and backward-safe.
- `<description>` (HTML release notes) is shown in the dialog — the place for a real message.

## Decision
`renderInformationalItem` now emits: `<title>`, a `<description>`, the sentinel `<sparkle:version>`, a
fixed `<sparkle:shortVersionString>` (`"Access renewal"`, so the number is never shown), an empty
`<sparkle:informationalUpdate>`, and the `<link>` — still **no enclosure**.

The **title** and **message** are operator-editable, stored in `meta.notice_title` / `meta.notice_message`
(persisted by the existing Settings form, decision-0009-style meta keys) with clear defaults in
`DEFAULT_ACCESS_NOTICE` (`core/invite-template.ts`). The message supports `{app_name}`, filled by
`loadAccessNotice` (`services/branding.ts`) exactly like the invite template. The display version string
is **not** editable — it's a fixed label, kept out of the Settings surface to stay minimal.

**Escaping (security).** The admin message is plain text rendered as HTML release notes in Sparkle's
WebView. It is `xmlEscape`d before being wrapped in `<p>…</p>` inside a `CDATA` block: escaping `< > &`
means no markup/script reaches the WebView, and escaping `>` guarantees the content can never contain
`]]>`, so it cannot break out of the CDATA. Newlines become `<br>`. Golden + hostile-input unit tests
cover this; the notice content is asserted end-to-end in CUJ-18.

## Consequences
- The notice is scoped to revoked/unknown only (decision 0010) — a valid no-build user still gets an
  empty feed, never this notice. Title/message edits surface for invalid tokens of any installed version.
- The sentinel (decision 0008) is unchanged as the comparison key; only its *display* is now overridden.
- No migration: `meta` is a generic KV table; the two new keys flow through the existing Settings form
  and `getAll`. CUJ-3/4/5 still pass (sentinel + no-enclosure unchanged); appcast goldens updated.
