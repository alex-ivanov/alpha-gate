# 0001 — Stack: Hono + hono/jsx, Biome

**Status:** accepted · **Date:** 2026-06-13

## Context
`DESIGN.md` fixes the shape (single `src/worker.ts`, ROLE-switched, server-rendered HTML with plain
`<form>` POSTs, behind Cloudflare Access) but not the routing/HTML toolkit or the lint/format tooling.

## Decision
- **Routing + HTML: Hono + `hono/jsx`** (one dependency, ~14 kB, Workers-first). One Hono app per role;
  the ROLE-switched `worker.ts` mounts `routes/app` or `routes/admin`. JSX renders the admin and landing
  pages; the Access-JWT gate is a single Hono middleware on the admin app.
- **Lint + format: Biome** — one fast binary, minimal config. Fits the "keep deps/sizes under control"
  guidance. `shellcheck` covers the bash scripts separately (§23).

## Consequences
- Views are pure JSX-over-props, testable with zero runtime.
- Biome carries a custom rule forbidding `new Date()` / `Date.now()` outside `src/lib/clock.ts` and
  `test/support/` (enforces the clock seam — see `CANONICAL-LAYOUT.md`).
- Alternatives considered: zero-dependency hand-rolled router + tagged-template HTML (smaller footprint,
  but reinvents routing/escaping/middleware for exactly Hono's sweet spot); ESLint+Prettier (heavier).
