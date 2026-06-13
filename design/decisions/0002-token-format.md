# 0002 — Token format

**Status:** accepted · **Date:** 2026-06-13

## Context
§5 declares `clients.token TEXT NOT NULL UNIQUE`; §6/§7 use it as a URL query param **and** a value
hand-pasted into the macOS app on first launch. The doc never pins length, alphabet, or generation.
It is the sole credential.

## Decision
- Generate **≥160 bits** from `crypto.getRandomValues` and encode as **Crockford base32** (~26–32 chars,
  no padding, no hyphens, unambiguous alphabet — no `0/O/1/l/I` confusion, double-click-selectable).
- Lookup is **case-insensitive**: `normalizeToken()` folds to one case before any DB query.
- Uniqueness via the DB `UNIQUE` constraint; retry on the astronomically unlikely clash.
- All of this lives in one pure `core/tokens.ts` as the single source of truth: `generateToken()`,
  `isWellFormedToken()`, `normalizeToken()`.

## Consequences
- Paste-safety and no double-click-breaking characters beat compactness — the token is typed/pasted by
  humans.
- This is a contract with the out-of-scope app's activation screen. **To confirm before M1 locks
  `generateToken()`:** any max-length constraint on the app's paste field. Default assumes none.
- Security note: the token travels in query strings, so it lands in Cloudflare logs/Referer/history.
  Mitigations live in the route layer (`Referrer-Policy: no-referrer` on `/get`, generic 404s); accepted
  for a private alpha and documented in the risk register.
