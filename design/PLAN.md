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

- ☐ **M0 — Scaffold.** npm + strict TS + Biome + vitest-pool-workers (offline). Migrations
  `0001`–`0006` (0006 = DMG columns, see decision 0003) transcribed from §5. `wrangler.template.toml`
  from §18. Empty typed `src/` skeleton. **Gate:** `npm test` green offline (smoke test + migrations
  apply), `tsc --noEmit` clean, `biome check` clean. CUJ: none (foundational).
- ☐ **M1 — Pure core: types + tokens + version.** `core/types.ts`, `core/tokens.ts` (Crockford
  base32, ≥160 bits — decision 0002), `core/version.ts`. **Gate:** unit tests for token shape/entropy
  and version truth-table.
- ☐ **M2 — Pure core: the resolver.** `core/resolver.ts` — `resolve(client, builds, streams) →
  target | informational | none` (§8). **Gate:** a single auditable decision-table test covering the
  whole space (unknown/revoked/pinned/multi-stream/stranded). Proves the core of CUJ-2/3/8/9/10/11.
- ☐ **M3 — Pure core: no-build + §11 validation.** `core/no-build.ts`, `core/validation.ts`. Shares
  the resolver so preview and runtime can't disagree. **Gate:** affected-set truth tables; cross-check
  that affected users resolve to `none`.
- ☐ **M4 — Pure core: appcast XML.** `core/appcast` — update item + §15 informational item (sentinel
  version, no enclosure), XML-escaping everywhere. **Gate:** byte-exact golden tests + hostile-input
  escaping test.
- ☐ **M5 — Pure core: audit hash-chain + invite template.** `core/audit-chain.ts` (versioned
  canonical form — decision 0005), `core/invite-template.ts`, `templates/invite-email.txt`. **Gate:**
  chain build/verify + tamper-detection; template render + default branding.
- ☐ **M6 — Pure views.** `views/layout.tsx`, `views/get-page.tsx`, `views/access-page.tsx`,
  `views/admin/*.tsx` (split per page from the start). **Gate:** render-with-props markup assertions.
- ☐ **M7 — env + D1 query layer.** `env.ts`, `lib/clock.ts` (the only time source), `db/client.ts`
  + one module per aggregate (raw prepared statements, no ORM). **Gate:** integration tests per module
  against seeded D1; prune + stats with seeded timestamps.
- ☐ **M8 — R2 + token gate + Deps container.** `r2/keys.ts`, `r2/builds-bucket.ts` (never presigns),
  `auth/token-gate.ts`, `deps.ts` (the single DI mechanism). **Gate:** R2 round-trip + key layout;
  token gate no-existence-leak.
- ☐ **M9 — App routes 1: /get, /download, /assets, /access (ROLE=app).** **Gate:** CUJ-1 (get+download
  half), CUJ-3 (get+download half), CUJ-6.
- ☐ **M10 — App route: /appcast.** Resolver → appcast XML → log `check` with `&installed=` (decision
  0004). **Gate:** CUJ-1 (complete), CUJ-2, CUJ-3 (complete), CUJ-7, CUJ-8 (resolve half).
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
