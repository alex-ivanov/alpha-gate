# Contributing

How development works in this repo. The durable architecture & product principles are in
[`docs/PRINCIPLES.md`](docs/PRINCIPLES.md); the structural rules (the `Deps` DI container, the clock
seam) are summarised under [Architecture in one breath](#architecture-in-one-breath) below.

## Setup

```bash
npm install        # no Cloudflare account needed for development or tests
npm run check      # the full gate: biome + tsc + vitest (all offline)
```

| Command | What |
|---|---|
| `npm test` | vitest-pool-workers, offline (Miniflare simulates D1/R2/cron in `workerd`) |
| `npm run test:watch` | watch mode |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` / `npm run format` | Biome check / write |
| `npm run check` | lint + typecheck + test |
| `./deploy/dev.sh` | run the App Worker locally on `:8787` (Miniflare D1/R2, no account), seeded so `/get`/`/appcast`/`/download` work |

`npm test` is the primary validation — it exercises the real handlers offline. `./deploy/dev.sh` is
for poking the **live HTTP surface** in a browser/curl: it renders a local wrangler config, applies
migrations to a local DB, seeds a demo client/build, and starts `wrangler dev`. Flags: `--port`,
`--no-seed`, `--reset`, `--role admin`.

`--role admin` opens the gated back office at `localhost/admin` via a **local-dev auth shim**
(`src/dev/admin-entry.ts`): it runs the real admin app + Access verifier against a throwaway in-process
keypair and auto-injects a dev assertion, so the UI (and mutations, audited as `dev@local`) work in a
browser without Cloudflare Access. It is localhost-only and **cannot ship** — nothing in `worker.ts` or
the deploy template references it, and it refuses to serve unless `DEV_ADMIN=1` (only `dev.sh` sets it).
Production admin auth (decision 0006) is unchanged and still covered by `npm test`.

The four things that need a real (throwaway) deploy: Access login (the genuine edge JWT), Cloudflare
email delivery, bucket-lock, and an end-to-end Sparkle client (see
[`docs/PRINCIPLES.md`](docs/PRINCIPLES.md#design-for-testability)).

### The deploy CLI

`dev`, `deploy`, and `teardown` are a **TypeScript CLI** under `src/deploy/`; the `deploy/*.sh` files are
three-line `tsx` wrappers. It
follows the same pure-core/seams rule as the app: `core/` is I/O-free and unit-tested (arg parsing,
`renderConfig`, the defensive `wrangler`-output parsers, the inspect→apply plan, the state ledger, the
console UI), while `seams/` is the only I/O — `wrangler` (spawns with **argv arrays**, never a shell
string; `run()` captures output and never rejects, `exec()` inherits stdio for `wrangler dev`), `files`,
`io`, `clock`. Commands orchestrate a **preflight → inspect (read-only) → confirm → apply** flow with live
progress; `--dry-run` runs against a mocked wrangler and touches neither the account nor disk.

It is a **separate build**: `tsconfig.deploy.json` (`types: ["node"]`) and a node-env vitest project
(`test/vitest.deploy.config.ts`), kept apart from the app's workers-types config. `npm test` and
`npm run typecheck` run both suites; tests live in `test/deploy/*` and assert on the fake wrangler's
recorded argv and the fake filesystem (`npm run ui:preview` renders the console panels). `shellcheck`
(CI, or `brew install shellcheck` locally) lints the thin bash wrappers.

## Architecture in one breath

I/O lives at the edges; the logic is pure. A request flows:

```
worker.ts (ROLE switch) → routes/{app,admin}/* (Hono handlers)
   → receive Deps (db, r2, clock, access, email, fetch) — never bindings directly
   → call core/* PURE functions (resolver, no-build, appcast, audit-chain, tokens, version)
   → through db/* (raw prepared statements, no ORM) and r2/* (never presigns)
   → render views/* (pure hono/jsx, props in → HTML out)
```

Two structural rules:
1. **`Deps` DI** — handlers/services receive a `Deps` object; tests swap each seam (a fixed clock, a
   stub Access verifier, a recording email sender, a mocked fetch).
2. **`lib/clock.ts` is the only source of time** — a Biome rule forbids `Date`/`Date.now()` elsewhere,
   so anything time-dependent takes a `Clock` and tests seed it.

## Conventions

- **Pure core first.** Put decision logic in `src/core/*` as plain functions over plain data; keep
  bindings out. Most of the system's logic is there and is unit-tested with zero runtime.
- **Defensive programming, fail closed.** Validate inputs at every boundary (ids, emails, manifests,
  upload sizes). On the security paths (Access JWT, token gate) reject on *any* error — never fall open.
- **Separation of concerns; small files.** One module per table in `db/`, one page per file in
  `views/`, shared helpers extracted (`routes/admin/form.ts`, `confirm.tsx`, `audit-fields.ts`). Split a
  file before it gets unreadable.
- **No ORM.** Raw prepared statements behind `db/client.ts`; map snake_case rows to the camelCase domain
  types from `core/types.ts` inside the db module, so no other layer sees column names.
- **`verbatimModuleSyntax`** — use `import type` for type-only imports.

## Testing

Tests run inside the Workers runtime offline. Layout under `test/`:

- `unit/` — pure-core tests (resolver decision table, appcast golden files, audit chain, …).
- `integration/` — db/r2/auth/cron against seeded D1/R2 in `workerd`.
- `cuj/` — the **Critical User Journeys**. These are the feature gates; read `NN-name.cuj.test.ts`
  as the human-readable contract for a journey.
- `support/` — the offline harness: `scenario.ts` (seed a servable world *through the prod queries*),
  `access.ts` (a throwaway RS256 keypair signing real Access tokens against a stub JWKS), `worker.ts` /
  `adminWorker` (apps wired to the test env with overridable Deps), `db.ts` (`resetAll` in `beforeEach`),
  `clock.ts` (`fixedClock`), `email.ts` (recording sender).
- `deploy/` — the deploy-CLI suite (node env, **not** workers-pool; see *The deploy CLI* above), run by
  `npm run test:deploy` and as the second half of `npm test`.

Notes: D1/Miniflare **enforces foreign keys**, so seed parent rows (e.g. a stream) before linking;
assert time-dependent behavior with seeded timestamps (fake timers don't reach the R2/KV simulators).

## Adding a feature (TDD)

1. **Write the failing test first** — a CUJ in `test/cuj/` for a user-visible journey, or a unit test
   for new pure logic. Make it red.
2. **Implement the pure core** in `src/core/*` (and unit-test it directly).
3. **Wire the seam/route** — a `db/` query, an `r2/` call, a `routes/*` handler receiving `Deps`, a pure
   `views/*` component. Reuse the shared helpers; require a human actor + record an audit row for admin
   mutations; run the no-build confirm gate (`guardStranding`) for anything that could strand a user.
4. **Green + clean** — `npm run check` passes (tests + tsc + Biome).
5. **Keep docs current** — if you change a durable invariant, update
   [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md); operator-facing changes go in `docs/ONBOARDING.md` /
   `docs/UPLOADING.md`.

## Releasing

Deployed instances self-update by polling `release.json` daily (the manifest URL is derived from the
checkout's git origin, so forks self-point). To cut a release:

1. Bump `VERSION`, `package.json`'s `version`, and `release.json`'s `latest` **to the same value**.
2. Set `release.json`'s `breaking: true` and bump `min_supported` if the upgrade needs manual steps.
3. Add a `## <version>` section to `CHANGELOG.md` (what `notes_url` points at).
4. Tag and push. Operators see the banner within 24h and re-run `deploy.sh` to update.

## Commits

Small, focused commits — one cohesive change each. Run the tests before committing and add a line about
their status to the message (e.g. `Tests: 200 passing`). Describe what changed, not who changed it.
