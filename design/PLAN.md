# Implementation Plan

Living checklist for building Alpha Gate. Source of truth for *what* is in `design/DESIGN.md`;
this file is the *how* and *in what order*. Update it as milestones close or the plan changes.

Derived from a cross-validated planning pass (decomposition + CUJ→test-gate mapping + risk
register + test architecture). Companion docs:
- `design/CANONICAL-LAYOUT.md` — the agreed module tree, the `Deps` DI rule, the clock seam.
- `design/decisions/` — the decisions that `DESIGN.md` did not pin down.

## Principles (from CLAUDE.md)

- **TDD.** Write the failing test first. The §12 Critical User Journeys (CUJs) are the feature gates.
- **Pure core, I/O at the edges.** Most logic is plain functions over plain data, tested with zero runtime.
- **Small commits, often.** Each milestone lists its commit boundaries. Run `npm test` before every
  commit and note status in the message.
- **Isolation of concerns; small files.** Split before a file gets unreadable.
- **Defensive programming.** Guard inputs at boundaries; fail closed on the security paths.

## Ordering rule

Strictly dependency-driven, but p0 work is pulled as early as dependencies allow. No p0 CUJ is
deferred behind a p1/p2 CUJ. The five highest-risk surfaces are de-risked at: M2 (resolver),
M4 (appcast golden), M5 (audit chain), M11 (Access JWT), M15 (upload boundary).

## Milestones

Legend: ☐ todo · ◐ in progress · ☑ done

- ☑ **M0 — Scaffold.** npm + strict TS + Biome + vitest-pool-workers (offline). Migrations
  `0001`–`0006` (0006 = DMG columns, see decision 0003) transcribed from §5. `wrangler.template.toml`
  from §18. Typed `src/env.ts`. **Gate met:** `npm test` 4/4 offline (smoke + migrations apply),
  `tsc --noEmit` clean, `biome check` clean. _Note: vitest-pool-workers 0.16 configures via the
  `cloudflareTest()` Vite plugin (no `defineWorkersConfig`); Biome no-`Date` rule deferred to M7
  (its allow-list targets don't exist yet)._
- ☑ **M1 — Pure core: types + tokens + version.** `core/types.ts`, `core/tokens.ts` (Crockford
  base32, ≥160 bits — decision 0002), `core/version.ts`. **Gate met:** 30 unit tests (token
  shape/entropy/normalize, version truth-table + malformed-manifest defensiveness); tsc + Biome clean.
- ☑ **M2 — Pure core: the resolver.** `core/resolver.ts` — `resolve(input) → target | informational |
  none` (§8). **Gate met:** 11-row decision table (unknown/revoked/pinned/multi-stream/withdrawn).
  41 tests; tsc + Biome clean. _`none` carries no sub-reason — empty/stranded is M3's job (needs
  installed-build context §8 resolution never uses)._
- ☑ **M3 — Pure core: no-build + §11 validation.** `core/no-build.ts`, `core/validation.ts`. Shares
  the resolver so preview and runtime can't disagree. **Gate met:** `noBuildState` (servable/empty/
  stranded, installed-build-aware for no-downgrade), `computeAffectedUsers`, `validateAction` with
  guards. 63 tests; tsc + Biome clean.
- ☑ **M4 — Pure core: appcast XML.** `core/appcast.ts` — update item + §15 informational item
  (sentinel version, no enclosure), XML-escaping everywhere. **Gate met:** byte-exact golden tests
  (normal/critical/min-os/informational/full-feed) + hostile-input escaping. 72 tests; clean.
- ☑ **M5 — Pure core: audit hash-chain + invite template.** `core/audit-chain.ts` (versioned
  canonical form — decision 0005), `core/invite-template.ts`, `templates/invite-email.txt`. **Gate
  met:** chain build/verify/tamper-detection + canonical determinism; invite fill + branding defaults.
  86 tests; tsc + Biome clean.
- ☑ **M6 — Pure views (public).** `views/layout.tsx` (+ `renderPage` doctype helper), `views/get-page.tsx`,
  `views/access-page.tsx`. **Gate met:** render-with-props markup + escaping; 94 tests. _Admin views
  (`views/admin/*.tsx`) deferred to their consuming milestones (M12+) so prop shapes follow the real
  query/handler data rather than being guessed — split per page when they land._
- ☑ **M7 — env + D1 query layer.** `env.ts` (readEnv), `lib/clock.ts` (only time source; Biome
  no-`Date` rule now active), `db/client.ts` + clients/builds/streams/access-log (raw, no ORM).
  **Gate met:** 111 tests — per-module integration against seeded D1; prune + stats with seeded
  timestamps; FK enforcement confirmed. _`db/admin-audit` + `db/meta` deferred to consumers (M12/M15/M16)._
- ☑ **M8 — R2 + token gate + Deps container.** `r2/keys.ts`, `r2/builds-bucket.ts` (never presigns),
  `auth/token-gate.ts`, `deps.ts` (`{db,r2,clock}`, grows with access/email/fetch). **Gate met:** R2
  round-trip + key path-escape; token gate active/revoked/unknown + case-insensitive. 125 tests.
- ☑ **M9 — App routes 1: /get, /download, /assets, /access (ROLE=app).** **Gate met:** CUJ-1
  (get+download), CUJ-3 (get+download), CUJ-6; Referrer-Policy + nosniff; /admin/* → 404. 136 tests.
- ☑ **M10 — App route: /appcast.** Resolver → appcast XML → log `check` with `&installed=` (decision
  0004). **Gate met:** CUJ-1 (complete), CUJ-2, CUJ-3 (complete), CUJ-7, CUJ-8 (resolve half). 143 tests.
- ☐ **M11 — Access JWT + admin middleware + ROLE gating.** `auth/access-jwt.ts` (fail-closed, RS256
  pinned, aud/iss, JWKS-with-TTL behind a seam, service-token vs email — decision 0006), single
  middleware mount. **Gate:** CUJ-12 + verifier truth-table.
- ☐ **M12 — Audit + email + admin read views.** `services/audit.ts` (atomic chain write),
  `services/email.ts` (sender seam), `routes/admin/views.ts`. **Gate:** chain doesn't fork under
  concurrent append; read views render.
- ☐ **M13 — Admin client mutations.** create/revoke/reissue/pin/assign, each with §11 validation +
  audit. **Gate:** CUJ-4, CUJ-5, CUJ-8 (complete), CUJ-9.
- ☐ **M14 — Admin build mutations + §11 confirm.** withdraw/restore/link/critical/rollback-designate.
  **Gate:** CUJ-10, CUJ-11.
- ☐ **M15 — Upload/register + branding + the 100 MB boundary.** Full upload (≤~90 MB ceiling) +
  metadata-only register (HEAD R2, assert size==declared — decision 0007); service-token accepted
  *only* here. **Gate:** CUJ-17 (Worker side), CUJ-18, size-ceiling + length-mismatch tests.
- ☐ **M16 — Cron + final worker.ts.** `services/self-update.ts`, `services/anchor.ts`, `cron.ts`,
  finalized `worker.ts`. **Gate:** CUJ-15, CUJ-19, CUJ-20 (prune).
- ☐ **M17 — Deploy + teardown scripts.** `deploy/deploy.sh`, `deploy/teardown.sh`, offline `--dry-run`
  + shellcheck. **Gate:** CUJ-13, CUJ-14, CUJ-16.
- ☐ **M18 — Publish scripts + GitHub Actions.** `publish.sh`, `ci-publish.sh`, `.github/workflows/publish.yml`.
  **Gate:** CUJ-17 (CI plumbing complete), shellcheck.

## CUJ → milestone map

| CUJ | Journey | Closes at |
|---|---|---|
| 1 | First install | M9 + M10 |
| 2 | Normal update | M10 |
| 3 | Resolver gating (unknown token) | M9 + M10 |
| 4 | Revoke | M13 |
| 5 | Reissue | M13 |
| 6 | Redownload / reinstall | M9 |
| 7 | Critical / mandatory update | M10 |
| 8 | Multiple update channels | M10 (resolve) + M13 (reassign) |
| 9 | Pinned version | M13 |
| 10 | Withdraw (roll-forward) | M14 |
| 11 | No-build confirmation | M14 |
| 12 | Admin auth (Access) | M11 |
| 13 | Operator install | M17 |
| 14 | Second instance | M17 |
| 15 | Tool self-update | M16 |
| 16 | Update the tool in place | M17 |
| 17 | Publish via CI | M15 (Worker) + M18 (plumbing) |
| 18 | Branding / invite template | M15 |
| 19 | Audit anchor / tamper-evidence | M16 |
| 20 | Stats + log prune | M7 + M16 |

## Open items still to ratify (non-blocking)

- `UPDATE_MANIFEST_URL` real org/repo path + `release.json` shape — before any real deploy (M16/M17).
  Working shape recorded in decision 0004's sibling note; fetch is mocked in tests.
- Token paste-field constraints on the (out-of-scope) app side — confirm before M1 locks `generateToken()`
  if the app limits key length (decision 0002).
