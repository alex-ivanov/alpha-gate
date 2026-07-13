# Alpha Gate

A lightweight, self-hosted distribution gate for a notarized macOS app updated via **Sparkle**. It gates
downloads and the per-user Sparkle update feed behind a token, manages clients / builds / release
channels / pins / rollbacks from an admin back office behind **Cloudflare Access**, and runs entirely on
**Cloudflare (Workers + D1 + R2)** within the free tier — no custom domain, deployable to any account from
one script, with many isolated instances per account.

> Status: feature-complete and tested — 376 worker + 93 deploy-CLI tests, all offline; `tsc` (both
> configs) and Biome clean.

## Features

- **One private link per user** (`/get?token=`) → download + an `myapp://activate` deep link + the
  pasteable key. The token is the only credential; users never log in.
- **Per-request Sparkle appcast** generated from the database — gating, re-download, channels, pinning,
  rollback, and revocation notices all fall out of one resolver.
- **Release channels, pinning, and rollback** (roll-forward, since Sparkle can't downgrade).
- **Publish a signed `.dmg` or `.zip`** from a one-command script, CI, or the browser — all converging on
  one upload endpoint; the Worker never signs and never holds a signing key.
- **Admin behind Cloudflare Access** (one-time-PIN email allowlist) with defense-in-depth JWT
  verification, and a **tamper-evident, hash-chained audit log**.
- **Free-tier**: D1 + R2 + Workers, no custom domain. Copy-paste invites by default; Cloudflare email is
  an optional, paid add-on (it needs a real domain).

## How it works

The same code deploys **twice**, switched by a `ROLE` var, onto two `workers.dev` hostnames that share one
D1 database and one R2 bucket:

```
   macOS app ──► /appcast?token=   ┌─────────────────────────┐
   (Sparkle)    /download?token=   │  App Worker (public)     │──┐
                                   │  • token gate, resolver  │  │   ┌── D1 (clients, builds,
   User ──────► /get?token=        │  • binary stream from R2 │  ├──►│   channels, access_log, audit)
   (browser)    landing page       └─────────────────────────┘  │   └── R2 (build archives, branding)
                                                                 │
   Admin ─────► /admin             ┌─────────────────────────┐  │
   (Cloudflare  [Cloudflare Access]│  Admin Worker (gated)    │──┘
    Access)     ───────────────────│  • clients/builds/channels, validates the Access JWT
                                   └─────────────────────────┘
```

Why two Workers: on `workers.dev`, Cloudflare Access protects an entire hostname, so the public routes
(which Sparkle must reach) and the gated admin must live on separate hostnames. Both are host-agnostic
(they derive their origin from the request), so they run on bare `*.workers.dev` URLs with no config. Full
rationale and the invariants behind the design: [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md).

## Quick start

From npm — no clone, a pinned versioned release:

```bash
npx wrangler login                       # once, interactive
npx alpha-gate deploy --instance myalpha # provision D1 + R2, deploy both Workers (idempotent)
npx alpha-gate publish MyApp.dmg --channel beta
```

Or from a git clone (contributors, or to run unreleased `main`):

```bash
git clone <your-fork> alpha-gate && cd alpha-gate && npm install
./deploy/deploy.sh --instance myalpha    # the deploy/*.sh wrappers = the same CLI
```

Then lock the admin behind Cloudflare Access and re-run deploy with your team domain + AUD. The full,
step-by-step path — install, prepare the account, deploy, Access, verify — starts at
**[docs/setup/install.md](docs/setup/install.md)**.

To ship builds: wire Sparkle into your app ([Swift](docs/integrate/sparkle-swift.md) or
[Go](docs/integrate/sparkle-go.md)), [add users](docs/operate/add-users.md), and
[publish](docs/operate/publish.md). Once set up, publishing is one command:

```bash
./publish.sh MyApp.dmg --channel beta
```

It reads the version from the app, signs with Sparkle's `sign_update`, links the channel by name, and
picks the instance automatically when only one is deployed.

## Develop

Everything runs **offline** — no Cloudflare account, no network — inside the Workers runtime via
`@cloudflare/vitest-pool-workers` (Miniflare simulates D1/R2/cron with isolated per-test storage).

```bash
npm run check     # the full gate: biome + tsc (both configs) + tests
npm test          # tests only (offline)
./deploy/dev.sh   # run BOTH Workers locally, seeded (app :8787, admin :8788); --role app|admin for one
```

Conventions, architecture, and how to add a feature: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Documentation

| Doc | What |
|---|---|
| [`docs/README.md`](docs/README.md) | The documentation index: setup, integrate, operate, maintain. |
| [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) | The durable architecture & product principles and hard constraints. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Developer guide: conventions, architecture, testing, adding a feature. |
| [`CLAUDE.md`](CLAUDE.md) | Working guidance for AI assistants in this repo. |

## Project structure

```
src/
  worker.ts          # entrypoint — reads env.ROLE, mounts app|admin, exports fetch + scheduled
  core/              # PURE logic (no I/O): resolver, no-build, appcast XML, audit hash-chain, tokens, version
  views/             # pure hono/jsx pages (public + admin/, incl. injected client scripts)
  db/                # raw D1 prepared statements, one module per table (no ORM)
  r2/                # R2 archive + branding access (never presigns)
  auth/              # token gate + Cloudflare Access JWT verifier
  services/          # audit, email, self-update, anchor, branding (orchestration over db/r2/core)
  routes/{app,admin} # Hono handlers; deps injected, never bindings directly
  deploy/            # deploy/teardown/dev CLI: core/ (pure) + seams/ (wrangler,fs,io,clock) + commands/
migrations/          # 0001–0010 D1 schema (SQL)
deploy/              # thin bash wrappers (deploy.sh, teardown.sh, dev.sh) → the TS CLI; backup.sh (D1 dump)
publish.sh           # ONE publish command (dmg | .app.zip | CI)
bin/alpha-gate.mjs   # the npm entrypoint: npx alpha-gate deploy|dev|publish|backup|teardown
test/                # unit/ integration/ cuj/ + support/ (offline vitest-pool-workers)
docs/                # the docs: setup/ integrate/ operate/ maintain/ + PRINCIPLES (index: docs/README.md)
site/                # the marketing page (static HTML + screenshots; see site/README.md)
```

## Security notes

- The token travels in URLs, so it appears in Cloudflare's own request logs (accepted for a private
  alpha); `/get` sets `Referrer-Policy: no-referrer` and bad tokens get a generic 404 (no existence leak).
- The Sparkle feed is **not** signed (`SURequireSignedFeed` off) — incompatible with per-user dynamic
  feeds; the per-archive EdDSA signature still blocks tampered binaries.
- The admin JWT verifier is **fail-closed** (RS256-pinned, `aud`/`iss` + expiry checked); service tokens
  are accepted only on the upload/register routes.
- Admin actions are recorded in a **hash-chained, daily-anchored** audit log; pair it with Cloudflare's
  Access and Audit logs for full who/when.
- Account-level caveat: anyone with Cloudflare dashboard access to the account can read D1/R2 directly;
  install into a dedicated account if that isolation matters.

More on the security model and the invariants: [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md).
