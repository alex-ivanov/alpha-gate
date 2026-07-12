# Alpha Gate — principles & constraints

The durable ideas behind Alpha Gate: the invariants that must keep holding, and the hard constraints
that shaped the design. This replaces the original `design/` spec (now in git history). It is the
reference to read before changing core behavior — operational how-to lives in
[ONBOARDING](ONBOARDING.md) and [UPLOADING](UPLOADING.md); the developer workflow in
[CONTRIBUTING](../CONTRIBUTING.md).

> Legacy note: many code comments cite `§N` (e.g. `§8`, `§11`). Those referred to sections of the old
> `design/DESIGN.md`; the durable content is distilled here. Treat the markers as historical anchors.

## What it is

A self-hosted distribution gate for a notarized macOS app updated via **Sparkle**. It gates downloads
and the per-user Sparkle update feed behind a token, with an admin back office for clients, builds,
release channels, pins, and rollbacks. It runs entirely on **Cloudflare (Workers + D1 + R2)** within the
free tier, deployable to any account from one script, with many isolated instances per account.

## Architecture

**Two Workers, one dataset.** The same code deploys twice, switched by a `ROLE` var, onto two
`workers.dev` hostnames that share one D1 database and one R2 bucket:

- **App Worker (public)** — token gate, the per-request resolver, the appcast, binary streaming, the
  `/get` landing page. Sparkle and users reach it freely.
- **Admin Worker (gated)** — the back office and all mutations; its **whole hostname** sits behind
  Cloudflare Access.

**Why split.** On `workers.dev`, Cloudflare Access protects an entire hostname — there is no reliable
per-path gating. The public routes must stay open for Sparkle, so the admin cannot share that hostname.
Splitting gives a fully public app and a fully gated admin over one shared dataset.

**Host-agnostic.** Both Workers derive their origin from the incoming request, so they run on bare
`*.workers.dev` URLs with **no custom domain, DNS, or zone**. The admin/app host pair follows a fixed
naming contract (`alpha-gate-<instance>` and `alpha-gate-<instance>-admin`), which is how the admin
derives the public `/get` link host (`src/lib/hosts.ts`).

**The pivotal decision:** the appcast is **generated per request** from D1. Gating, re-download,
channels, pinning, rollback, and revocation notices all fall out of one resolver, so there is a single
source of truth (`src/core/resolver.ts`) the runtime, the download target, and the admin previews share.

## Hard constraints (the ones that bite repeatedly)

- **Sparkle cannot downgrade.** An item below the installed version is never offered. So "rollback" is
  always a **roll-forward**: rebuild the previous good code with a *higher* `build_number`. The same
  no-downgrade rule means pinning below, or moving a user to a channel whose top build is lower than
  what they run, won't take effect until a higher build exists.

- **`build_number` is the machine-comparable monotonic key** (Sparkle's `sparkle:version`);
  `short_version` is the human string (`sparkle:shortVersionString`). They diverge during a rollback.
  `build_number` must be a **positive integer** and must increase on every publish. Build metadata lives
  in D1 (the resolver queries by channel/status/version); R2 holds only the archive bytes.

- **Workers never sign and never hold a signing key.** All signatures — Developer ID + notarization,
  Sparkle EdDSA, any feed signature — are produced on **macOS** at publish time. The Worker only stores
  the bytes plus the fixed EdDSA string per archive. `SURequireSignedFeed` is **off**: it is incompatible
  with per-user dynamic feeds (it would put the signing key on the edge); the per-archive EdDSA still
  blocks tampered binaries.

- **The token is never embedded in the binary.** Embedding would break the notarization seal. The build
  is generic and signed once; the token reaches the app out-of-band via deep link
  (`myapp://activate?token=`) or paste on first launch.

- **Never hand out raw R2 or pre-signed URLs.** Every download routes through `/download?token=` so
  access logging and instant revocation hold.

- **The "no-build" state is surfaced, never silently blocked.** A user with no servable build (no
  available build in their channels, no channel at all, or pinned to a withdrawn build) gets an
  **empty appcast** — Sparkle stays "up to date". A user *stranded under no-downgrade* (their
  channel's top is below what they run) still receives that top item — the resolver never reads the
  installed build; Sparkle itself discards the lower item, with the same quiet "up to date" result.
  Admin actions that would create either state (withdraw, unlink, unassign, pin/unpin) are not
  blocked; they show which users would be affected and proceed on explicit confirmation. The remedy
  is roll-forward, reassignment, or unpin.

## The artifact model

The update enclosure is **format-agnostic**. Storage and the appcast assume nothing about the file: the
enclosure `type` is `application/octet-stream`, the URL is the extension-less `/download?…&via=update`,
and `/download` sends a `Content-Disposition` filename from the object key. So either a signed **`.zip`**
or a signed **`.dmg`** can be the Sparkle update artifact — Sparkle verifies the EdDSA, sees the filename,
and picks the right installer. A single signed DMG can serve both first-install and update.

R2 keys are built in exactly one place (`src/r2/keys.ts`): archives at
`build/<build_number>/<sanitized-filename>` (append-only; `build_number` is unique), branding at
`branding/icon` / `branding/header`, and an append-only audit anchor head.

## Security model

- **Admin auth is fail-closed.** The admin Worker verifies the Cloudflare Access JWT itself
  (RS256-pinned, `aud`/`iss` + expiry checked) as defense-in-depth on top of edge Access. Any error
  rejects. With the Access secrets unset, every admin request is denied. Service tokens are accepted on
  **only** the build upload/register routes (so a leaked CI credential is bounded to publishing).

- **Token-in-URL trade-off.** The token travels in URLs, so it appears in Cloudflare's own request logs
  (accepted for a private alpha). Mitigations: `/get` sets `Referrer-Policy: no-referrer`, and unknown
  tokens get a generic 404 (no existence leak).

- **Tamper-evident audit.** Every admin mutation is recorded in a **hash-chained** log, anchored daily to
  an append-only R2 object (and emailed when email is configured). A divergence from the last anchor —
  edit, truncation, rebuild — is flagged. Pair it with Cloudflare's Access auth logs and account Audit
  logs, which an attacker with account access cannot rewrite.

- **Account-level caveat.** Anyone with Cloudflare dashboard access to the account can read D1/R2
  directly. Install into a dedicated account if that isolation matters.

- **Branding inputs that reach a raw sink are validated.** The accent colour is interpolated raw into a
  public `<style>`, so it is constrained to a hex value (rejected on write, coerced on read). Uploaded
  branding images are raster-only (SVG is a stored-XSS vector when served from the app origin).

## The back office

The admin UI follows a few durable rules ("quiet instrument"), so changes should preserve them:

- **The resolver is visible.** The Overview serving map (channel → build → audience, plus an
  exhaustive *off the map* row), the Users list's **Next check** column, and every detail page's
  verdict strip are all computed by the same pure core the runtime uses (`core/verdict.ts` over
  `core/resolver.ts`) — the UI can never disagree with what Sparkle actually receives. "Which build
  does this user get, and why not?" must always be answerable on the page where you'd act on it.
- **Exception-only state.** Healthy states render as silence. `critical` is the single filled tag;
  withdrawn/revoked/pinned/hidden are quiet outlined tags; every fault is amber and carries its
  cause and a remedy. Builds are written exactly one way everywhere: the mono lockup
  `#1500 · v1.2.1` — never a DB row id.
- **The feedback loop closes.** Mutations 303 back to the page the operator acted from (validated
  `return_to`) with a flash slug the target page renders; free text never rides in the URL.
  Confirmation pages name their subject in operator words and Cancel returns to the origin.
  Destructive actions (revoke, reissue, delete channel) are always confirmed; revoke is reversible
  (**Reactivate** restores the same link). Stale forms are clear 400s *before* any write.
- **The audit chain means "something changed".** No-op re-posts (double submit, stale tab) are
  flash no-ops, not phantom audit rows; audit targets are human identifiers (emails, build
  numbers). The Audit page and Overview show the chain's live integrity via the same
  `assessChain` judgment the daily anchor records.
- **One vocabulary on operator surfaces:** user, channel, request. (URLs and DB keep `stream` /
  `pending` as stable contracts; only copy changed.)
- **Entity pickers are comboboxes over native selects.** Wherever a user or build is picked
  (pin, link, assign), the markup is a plain `<select>` that works with JavaScript disabled; the
  self-contained enhancer (`views/admin/combobox.tsx`) turns it into a type-to-filter combobox —
  multi-select (chips) on the channel page, whose batch routes accept repeated ids. New pickers
  should reuse it, not grow bare selects.
- **Theme follows the OS by default**, with a light/system/dark override (sidebar toggle → `theme`
  cookie → `data-theme` on `<html>`). The dark tokens exist once (`darkRules` in the admin layout)
  and apply both via `prefers-color-scheme` and via the forced attribute — never fork them.

## Email

Copy-paste invites are the **free-tier default**: with no email configured, every invite/notice is a
link the admin sends manually (the invite page has a one-click copy). Automated delivery uses Cloudflare
Email Service via the admin Worker's `send_email` binding — which requires **Workers Paid + a real,
onboarded sending domain** (SPF/DKIM DNS). **A `*.workers.dev` hostname cannot be that domain** (you
don't control its DNS), so a no-custom-domain instance must use copy-paste. Delivery sits behind an
`EmailSender` seam, so another provider (e.g. a single-sender transactional service that needs no domain)
can be added without touching the call sites. A misconfigured email setup falls back to copy-paste rather
than erroring, and a failed send never 500s — the page surfaces the reason and the link.

## Design for testability

I/O lives at the edges; the logic is **pure**. The resolver, the no-build computation, validation, the
audit hash-chain, and appcast XML generation are plain functions over plain data (no bindings), so most
logic is testable with zero runtime. Handlers and services receive a `Deps` object (db, r2, clock,
access, email, fetch) and never import bindings directly, so every seam is swappable in tests. `Date` /
`Date.now()` are forbidden outside `lib/clock.ts` (a lint rule enforces it) so time-dependent behavior
takes a seeded clock. The suite runs **offline** in the Workers runtime (`@cloudflare/vitest-pool-workers`
/ Miniflare). What that can't simulate — the real Access JWT, Cloudflare email delivery, bucket-lock, an
end-to-end Sparkle client — sits behind injectable seams and is the only thing needing a throwaway deploy.

**Client-side scripts gotcha.** The admin's small browser scripts (table sort/filter, upload autofill)
serialize **pure** functions into the page via `Function.prototype.toString()` so the browser runs the
exact tested code. A serialized function must reference **nothing** at module scope: a module-level
constant, or an esbuild runtime helper (`__name`, `__spreadValues`, `__async`, …), would be `undefined`
in the browser and throw. There is an identity shim for `__name`; a unit-test regex fails the build if
any other helper leaks in. Keep those functions self-contained (no inner-closure references, no spread/
async/`**`) and the contract holds.

## Operating principles

- **One idempotent script.** `deploy.sh` provisions D1 + R2, applies migrations, and deploys both
  Workers; re-running updates in place with data preserved. Deployment is **pure wrangler** — no API
  token, DNS, or zone. The two things a script can't do (enable Access on the admin hostname; create a
  service token) are printed as a one-time checklist.
- **Everything is namespaced by the instance slug**, so one account holds many independent instances
  (separate D1, R2, Workers, Access app, and per-slug state).
- **Two install channels, one CLI.** The same commands run from an npm install (`npx alpha-gate …`,
  the `bin`) or a git clone (`./deploy/*.sh`). The only difference is where per-instance state lives:
  `~/.alpha-gate` for npm (the package files sit in the ephemeral npm cache), `<repo>/.deploy` for a
  clone; `$ALPHA_GATE_HOME` overrides. So the rendered wrangler config uses **absolute** paths into the
  package for `main` and `migrations_dir` (`core/paths.ts` resolves the state dir; keep the two — code
  root vs state dir — distinct).
- **The self-update banner checks the npm registry.** The deployed Worker's daily cron polls
  `registry.npmjs.org/<name>/latest` and compares against its baked-in `TOOL_VERSION` (= the deploying
  package's version); the upgrade signals travel in `package.json`'s `alphaGate` field. It only
  **notifies** — a Worker never deploys itself (that would need a privileged Cloudflare API token on
  the edge, which the "no API token / hold no privileged creds" posture forbids). Updating stays an
  operator-run, human-in-the-loop `deploy` (safe for migrations).
