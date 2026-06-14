# 0010 — A no-build active user gets an empty appcast, not the reactivation notice

**Status:** accepted · **Date:** 2026-06-14

## Context
The §15 informational item (decision 0008) — `<title>Reactivate your access</title>`, the sentinel
`<sparkle:version>999000000</sparkle:version>`, a `<link>` to `/access`, **no enclosure** — exists so a
**revoked/unknown** token surfaces a renewal notice instead of a silent 403 (§8 step 1, §15).

The implementation and CUJ-11 over-applied it: `/appcast` mapped *any* non-target resolver outcome to
that item, including `{ kind: "none" }` — a **valid, active** user with no servable build (the §11
no-build state: no build published/assigned yet, or their only build was withdrawn/pinned-away). CUJ-11
asserted this ("knowingly left no-build → informational notice"), contradicting §8/§15, which scope the
notice to revoked/unknown.

The bite: Sparkle treats *any* enclosure-less item with `sparkle:version` above the installed build as an
**informational update** and shows a prompt. So a valid user with a working token saw a perpetual
"Reactivate your access" update — wrong message (their access is fine), wrong destination (`/access` is
*request* access), and an annoying prompt that can't be dismissed by updating (there's nothing to install).
Reported from a live instance: valid token, `/get` renders correctly, yet Sparkle keeps offering an update.

## Decision
For an **active** token, `/appcast` returns one of two feeds, never the reactivation notice:
- a **target item** when the resolver yields one (`{ kind: "target" }`), or
- an **empty feed** — `<channel>` with the title and **no `<item>`** — when nothing is servable
  (`{ kind: "none" }`). Sparkle reads this as "you're up to date" and shows no prompt; the user keeps
  whatever is installed (Sparkle can't downgrade anyway).

The reactivation notice (`renderInformationalItem`) is emitted **only** on the `gate.kind !== "active"`
path (revoked/unknown), matching §8/§15. The `check` access-log row is still written for the active
no-build user (it's a real check); revoked/unknown still write nothing (no token-existence signal, §6/§16).

The no-build state remains an **operator-facing** concept: the users list still flags it with an icon and
filter (§11/§13), and the §11 confirmation gate still lists who would be stranded before an admin proceeds.
Stranding a user is a deliberate, audited admin action — the remedy is roll-forward (a higher good build,
CUJ-10) or unpin/reassign, not a client-side prompt.

## Consequences
- `src/routes/app/appcast.ts` emits `items: []` for active + `none`; CUJ-11 now asserts no `<item>` /
  no sentinel / no enclosure. CUJ-3/4/5 (unknown/revoked/reissue → notice) are unchanged.
- `renderInformationalItem` and the sentinel (decision 0008) are unchanged — still used for
  revoked/unknown. This decision narrows *when* it's served, not the item itself.
- DESIGN §11 and the §8 endpoint table now state the active no-build feed is empty.
