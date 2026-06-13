# Canonical module layout

The single agreed file tree for the Worker codebase, plus the two structural rules that make the
offline test strategy work. This resolves naming drift once, in writing — if a doc, comment, or
agent refers to a module by another name, map it back here.

## Structural rules

1. **`Deps` dependency-injection container (`src/deps.ts`).** Route handlers and services never import
   bindings or seams directly. They receive a `Deps` object and are shaped `(deps, request) → Response`.
   `buildDeps(env)` is constructed once at the worker entry; tests build a `Deps` with seams swapped
   (stub Access verifier, recording email sender, mocked fetch, fixed clock). This is non-negotiable —
   it is how every seam is swapped per-test offline.

   ```ts
   interface Deps {
     db: D1Database
     r2: R2Bucket
     clock: Clock                 // () => ISO-8601 UTC string
     email: EmailSender           // interface; Cloudflare adapter or recording stub
     access: AccessVerifier       // injectable JWT verifier (JWKS fetch behind a seam)
     fetch: typeof fetch          // for the self-update manifest; mocked in tests
   }
   ```

2. **`src/lib/clock.ts` is the only source of time.** `type Clock = () => string` (ISO-8601 UTC) +
   `systemClock`. No `new Date()` / `Date.now()` anywhere else in `src/` — a Biome lint rule enforces
   this. Time-dependent behavior (log prune, self-update cadence, audit `created_at`) takes an explicit
   clock so tests seed it. D1's `datetime('now')` defaults are fine for columns we never assert on, but
   anything a test checks is written through the clock.

## Tree

```
src/
  worker.ts                 # §17 entry: reads env.ROLE, buildDeps(env), mounts app|admin, exports fetch + scheduled
  env.ts                    # Env binding types + defensive readEnv guard
  deps.ts                   # Deps interface + buildDeps(env)
  cron.ts                   # scheduled(): admin runs self-update + anchor + prune; app no-ops
  lib/
    clock.ts                # the only time source
  core/                     # PURE — no bindings, no IO, plain functions over plain data
    types.ts                # Client, Build, Stream, ResolverResult, AccessLogEvent, AdminAuditEntry, ...
    tokens.ts               # generateToken / isWellFormedToken / normalizeToken  (decision 0002)
    version.ts              # compareVersion / isUpdateAvailable                   (§22)
    resolver.ts             # resolve(client, builds, streams) → target|informational|none  (§8) ← pivotal
    no-build.ts             # isServable / computeAffectedUsers                     (§11)
    validation.ts           # pre-mutation predicates → allowed|needs-confirm + affected set (§11)
    appcast.ts              # renderUpdateItem / renderInformationalItem + xmlEscape (§8/§14/§15)
    audit-chain.ts          # canonicalize / computeHash / verifyChain / buildHead  (§16, decision 0005)
    invite-template.ts      # fill {app_name}/{get_url}/{token}; branded page model (§6/§13)
  views/                    # PURE hono/jsx — props in, HTML out
    layout.tsx
    get-page.tsx
    access-page.tsx
    admin/                  # one file per page (no monolith): dashboard, users-list, builds-list,
                            #   streams, build/stream/user management, upload, branding, ci, activity-log, audit-log
  db/                       # IMPURE — raw prepared statements, NO ORM; return plain rows for core
    client.ts               # one()/all()/run() wrapper over env.DB + error normalization
    clients.ts  builds.ts  streams.ts  access-log.ts  admin-audit.ts  meta.ts
  r2/                       # IMPURE
    keys.ts                 # the ONLY place R2 key layout is constructed (decision 0003)
    builds-bucket.ts        # putArchive/getArchive, putBranding/getBranding, putAuditAnchor — never presigns
  auth/                     # IMPURE seams
    token-gate.ts           # token → client|revoked|unknown, no existence leak
    access-jwt.ts           # verifyAccess(headers, {jwksFetcher, aud, teamDomain, now}) (decision 0006)
  services/                 # IMPURE orchestration over db/r2/core
    audit.ts                # atomic chain write (read head → hash → insert)
    email.ts                # EmailSender interface + Cloudflare adapter + recording stub
    self-update.ts          # fetch manifest → core/version → meta → one-per-version owner email
    anchor.ts               # buildHead → append-only R2 anchor + owner email; detect truncation/divergence
  routes/
    app/                    # public: get.ts appcast.ts download.ts assets.ts index.ts (mounts, 404s /admin/*)
    admin/                  # gated: middleware.ts (single mount) clients.ts builds.ts upload.ts branding.ts views.ts index.ts

migrations/                 # 0001..0006 (0006 = DMG columns, decision 0003)
templates/invite-email.txt
deploy/                     # wrangler.template.toml, deploy.sh, teardown.sh
publish.sh  ci-publish.sh   .github/workflows/publish.yml
VERSION

test/
  vitest.config.ts          # defineWorkersConfig, poolOptions.workers → test/wrangler.test.toml
  wrangler.test.toml        # committed test bindings (DB, BUILDS); ROLE injected per-test
  setup.ts                  # apply migrations to isolated D1; fetchMock activate + disableNetConnect
  support/                  # gwt.ts, clock.ts, fixture.ts (scenario builder via prod queries), expects.ts,
                            #   access.ts (throwaway RS256 keypair + stub JWKS), email.ts (outbox), actors.ts
  unit/ integration/ cuj/   # cuj/NN-name.cuj.test.ts files are the human-readable journey gates
```

## Name aliases (drift seen during planning → canonical)

`appcast-xml` → `core/appcast` · `archives` → `r2/builds-bucket` · `token`/`semver` → `core/tokens`/`core/version` ·
`admin/access`/`auth/verifier` → `auth/access-jwt` · `email/sender`+`email/template` → `services/email`+`core/invite-template` ·
`audit/chain` → `core/audit-chain` · `cron/self-update`/`selfupdate/version` → `services/self-update` + `cron.ts`.

## Note on the `routes/admin/views.ts` and `views/admin/` sizes

The planning decomposition listed these as single ~150–260 line entries. Treat them as **directory
placeholders**: split per page / per aggregate from the start so no monolith is ever written.
