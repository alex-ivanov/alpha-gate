# 0005 — Audit hash-chain canonicalization and atomic writes

**Status:** accepted · **Date:** 2026-06-13

## Context
§5/§16 specify `hash = SHA-256(prev_hash ‖ canonical(entry))` and a tamper-evident chain, but
`canonical(entry)` is undefined — which fields, what order, what serialization. The whole guarantee
depends on this being deterministic and reproducible (including offline, in another language).

## Decision
- **Versioned, hand-rolled canonical form** in pure `core/audit-chain.ts`. A fixed, ordered field list:
  `actor_email, action, target, detail, ip, ray_id, created_at, prev_hash`. Encode as length-prefixed,
  field-tagged bytes (each value preceded by its byte length) so no delimiter can be forged and there is
  no float/encoding ambiguity. Exclude `id` (autoincrement, unknown until insert) and `hash` itself;
  include `prev_hash`.
- A **`CANON_VERSION`** tag is part of the canonical input, so a future format change cannot silently
  invalidate old-chain verification.
- `verifyChain(rows) → ok | first-broken-index`; `buildHead(rows) → { hash, count }` for the anchor.
- **Atomic chain write** (in `services/audit.ts`, M12): read head → compute → insert as one D1
  transaction that re-reads the head, so concurrent admin mutations cannot fork the chain. Without
  atomicity the §16 guarantee is void.

## Consequences
- Reproducible offline verification is a stated goal of the breach-detection story (§16).
- Tests: round-trip build/verify, single-row edit detected at the right index, mid-chain deletion
  detected, byte-stable canonicalization across runs, and a concurrency test proving no fork.
