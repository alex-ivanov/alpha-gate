# Alpha Gate

A lightweight, self-hosted distribution gate for a notarized macOS app updated via **Sparkle**. It
gates downloads and the Sparkle update feed behind a per-user token, manages clients/builds/release
channels/pins/rollbacks from an admin back office behind **Cloudflare Access**, and runs entirely on
**Cloudflare (Workers + D1 + R2)** within the free tier — no custom domain, deployable to any account
from one script, with many isolated instances per account.

> Status: feature-complete and tested (200 tests, offline). See [Project status](#project-status) for
> the one deliberately-deferred piece and the admin-UI state.

## Features

- **One private link per user** (`/get?token=`) → download + an `myapp://activate` deep link + the
  pasteable key. The token is the only credential; users never log in.
- **Per-request Sparkle appcast** generated from the database — gating, re-download, channels,
  pinning, rollback, and revocation notices all fall out of one resolver.
- **Release channels, pinning, and rollback** (roll-forward, since Sparkle can't downgrade).
- **Admin behind Cloudflare Access** (one-time-PIN email allowlist) with defense-in-depth JWT
  verification in the Worker, and a **tamper-evident, hash-chained audit log**.
- **Publish from a script, the browser, or CI** — all converging on one upload endpoint; the Worker
  never signs and never holds a signing key.
- **Free-tier**: D1 + R2 + Workers, no custom domain. Copy-paste invites by default (Cloudflare Email
  Service is an optional, paid follow-up).

## How it works

The same code deploys **twice**, switched by a `ROLE` var, onto two `workers.dev` hostnames that share
one D1 database and one R2 bucket:

```
   macOS app ──► /appcast?token=   ┌─────────────────────────┐
   (Sparkle)    /download?token=   │  App Worker (public)     │──┐
                                   │  • token gate, resolver  │  │   ┌── D1 (clients, builds,
   User ──────► /get?token=        │  • binary stream from R2 │  ├──►│   streams, access_log, audit)
   (browser)    landing page       └─────────────────────────┘  │   └── R2 (build archives, branding)
                                                                 │
   Admin ─────► /admin             ┌─────────────────────────┐  │
   (Cloudflare  [Cloudflare Access]│  Admin Worker (gated)    │──┘
    Access)     ───────────────────│  • clients/builds/channels, validates the Access JWT
                                   └─────────────────────────┘
```

Why two Workers: on `workers.dev`, Cloudflare Access protects an entire hostname, so the public routes
(which Sparkle must reach) and the gated admin must live on separate hostnames. Both are host-agnostic
(they derive their origin from the request), so they run on bare `*.workers.dev` URLs with no config.

Full design rationale: [`design/DESIGN.md`](design/DESIGN.md).

## Prerequisites

- **Node ≥ 20** and **npm** (the repo pins `wrangler` as a dev dependency — use `npx wrangler`).
- **`jq`** and **`envsubst`** (from GNU gettext) for the deploy script. macOS: `brew install jq gettext`.
- A **Cloudflare account** (free tier is enough). Run `npx wrangler login` once.
- **macOS** only for `publish.sh` (Apple signing/notarization); not needed to deploy or develop.

## Install & deploy

```bash
git clone <your-fork> alpha-gate && cd alpha-gate
npm install
npx wrangler login              # once, interactive

./deploy/deploy.sh --instance myalpha
```

`deploy.sh` is idempotent: it creates the D1 database and R2 bucket if absent, renders the two wrangler
configs from one template, applies migrations, deploys both Workers, writes `.deploy/myalpha.state.json`,
and prints the app + admin URLs followed by a one-time checklist. Re-run it any time to update in place
(data is preserved). Try it without touching your account using `--dry-run`.

### One-time setup (printed by the deploy script)

1. **Protect the admin Worker with Cloudflare Access** — Dashboard → the `alpha-gate-myalpha-admin`
   Worker → Settings → Domains & Routes → enable *Cloudflare Access*, then add your email to the policy
   (one-time PIN). Access Zero Trust is free for up to 50 users.
2. **Give the admin Worker its Access identity** (defense-in-depth JWT check):
   ```bash
   npx wrangler secret put ACCESS_TEAM_DOMAIN --config .deploy/myalpha.admin.toml   # yourteam.cloudflareaccess.com
   npx wrangler secret put ACCESS_AUD         --config .deploy/myalpha.admin.toml   # the Access app's AUD tag
   npx wrangler deploy --config .deploy/myalpha.admin.toml
   ```
3. **Publish the first build** (on macOS): `./publish.sh --instance myalpha`.
4. *(optional)* **Email**: upgrade to Workers Paid, onboard a sending domain, then re-run deploy with
   `--email-provider cloudflare --email-from alpha@<your-domain>`. Without this, invites are copy-paste
   links shown in the admin UI (free, no domain).

Detailed runbook (publishing, inviting/revoking users, channels, rollback, self-update, teardown,
breach detection): [`docs/OPERATING.md`](docs/OPERATING.md).

## Publishing a build

Producing a build always happens on macOS (build → sign → notarize → staple → `sign_update` for the
Sparkle EdDSA signature). Only the **upload + registration** varies, and all paths hit one endpoint:

- **Local** — `./publish.sh --instance myalpha` (adapt the marked app-specific build block).
- **CI** — `ci-publish.sh` on a macOS runner with a Cloudflare Access **service token**; see
  [`.github/workflows/publish.yml`](.github/workflows/publish.yml).
- **Browser/curl** — `POST /admin/builds/upload` (multipart) or `/admin/builds/register` (metadata-only,
  for archives over the 100 MB Worker body cap). See the endpoint reference in `docs/OPERATING.md`.

## Develop

Everything runs **offline** — no Cloudflare account, no network — inside the Workers runtime via
`@cloudflare/vitest-pool-workers` (Miniflare simulates D1/R2/cron with isolated per-test storage).

```bash
npm test          # vitest-pool-workers, offline
npm run typecheck # tsc --noEmit (strict)
npm run lint      # biome check
npm run format    # biome format --write
npm run check     # lint + typecheck + test (the full gate)
```

Conventions, architecture, and how to add a feature: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Project structure

```
src/
  worker.ts          # entrypoint — reads env.ROLE, mounts app|admin, exports fetch + scheduled
  core/              # PURE logic (no I/O): resolver, no-build/§11, appcast XML, audit hash-chain, tokens, version
  views/             # pure hono/jsx pages (public + admin/)
  db/                # raw D1 prepared statements, one module per table (no ORM)
  r2/                # R2 archive + branding access (never presigns)
  auth/              # token gate + Cloudflare Access JWT verifier
  services/          # audit, email, self-update, anchor, branding (orchestration over db/r2/core)
  routes/{app,admin} # Hono handlers; deps injected, never bindings directly
  deps.ts  env.ts  cron.ts  lib/clock.ts
migrations/          # 0001–0006 D1 schema (SQL)
deploy/              # wrangler.template.toml, deploy.sh, teardown.sh
publish.sh  ci-publish.sh  .github/workflows/
test/                # unit/ integration/ cuj/ + support/ (offline vitest-pool-workers)
design/              # DESIGN.md (spec), PLAN.md, CANONICAL-LAYOUT.md, decisions/
```

## Documentation

| Doc | What |
|---|---|
| [`design/DESIGN.md`](design/DESIGN.md) | The architecture & behavior specification (source of truth). |
| [`docs/OPERATING.md`](docs/OPERATING.md) | Operator runbook: deploy, Access, publish, admin tasks, teardown, breach detection. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Developer guide: conventions, architecture, testing, adding a feature. |
| [`design/CANONICAL-LAYOUT.md`](design/CANONICAL-LAYOUT.md) | The module tree, the `Deps` DI rule, the clock seam. |
| [`design/decisions/`](design/decisions/) | Decision records (ADRs) for choices the spec left open. |
| [`CLAUDE.md`](CLAUDE.md) | Working guidance for AI assistants in this repo. |

## Security notes

- The token travels in URLs, so it appears in Cloudflare's own request logs (accepted for a private
  alpha); `/get` sets `Referrer-Policy: no-referrer` and bad tokens get a generic 404 (no existence leak).
- The Sparkle feed is **not** signed (`SURequireSignedFeed` off) — it's incompatible with per-user
  dynamic feeds; the per-archive EdDSA signature still blocks tampered binaries.
- The admin JWT verifier is **fail-closed** (RS256-pinned, `aud`/`iss` + expiry checked).
- Admin actions are recorded in a **hash-chained, daily-anchored** audit log; pair it with Cloudflare's
  Access and Audit logs for full who/when. See `design/DESIGN.md` §16.
- Account-level caveat: anyone with Cloudflare dashboard access to the account can read D1/R2 directly;
  install into a dedicated account if that isolation matters.

## Project status

Feature-complete against `design/DESIGN.md`; 209 tests pass offline; `tsc` and Biome clean. The back
office is fully operable from the browser — Add-user/Add-channel forms, per-row and per-entity actions
(revoke/reissue/pin/assign, build withdraw/restore/critical/link, channel create/delete), an upload
form, and a branding/settings page — all behind Cloudflare Access. Two tracked follow-ups remain:

- **`POST /access`** — the public request-access form renders but its submission (and a pending-requests
  queue) isn't handled yet.
- **Cloudflare Email Service** delivery is a documented follow-up behind the `EmailSender` seam;
  copy-paste invites (the free-tier default) are fully implemented.
