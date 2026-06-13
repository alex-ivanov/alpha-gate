# Alpha Gate — Design Doc

A lightweight, self-hosted distribution gate for a notarized macOS app updated via Sparkle. It runs entirely on Cloudflare (Workers + D1 + R2) within the free tier, gates downloads and the update feed behind a per-user token, manages clients from an admin page protected by Cloudflare Access, and supports release streams, pinned versions, and rollback. The whole thing deploys to any Cloudflare account from one script.

---

## 1. Goals and non-goals

**Goals**
- Gate downloads and the Sparkle feed behind a per-user token; one link per user.
- Invite users by email via **Cloudflare Email Service** (v1; needs Workers Paid + a sending domain), or by a copy-paste link on the free tier when email isn't configured.
- Manage clients, builds, streams, pins, and rollbacks from an admin page.
- Authenticate the admin with **Cloudflare Access** (single-admin email allowlist) — no passwords or hardware keys to manage.
- Run inside the Cloudflare free tier with no custom domain.
- Deploy and tear down an instance from one script, runnable by anyone with a Cloudflare account; many isolated instances per account.

**Non-goals**
- External telemetry or product-analytics dashboards (handled separately by Sentry / TelemetryDeck in the app). Simple distribution counts derived from the access log — downloads/updates per build, per-user last activity — are in scope; deep product analytics are not.
- Per-client binaries. The build is generic and signed once; the token is delivered out-of-band.
- A signed update feed (`SURequireSignedFeed`). Off for alpha — see §16.
- True downgrades. Sparkle cannot downgrade; rollback is implemented as roll-forward (§9).

---

## 2. Architecture overview

Two Workers, plus D1 and R2, plus one optional external dependency:

1. **App Worker** (public) — token validation, per-request appcast generation, binary streaming, the user landing page. No Access in front; Sparkle and users reach it freely.
2. **Admin Worker** (gated) — the admin UI and all mutations, with the whole hostname behind Cloudflare Access. Shares D1 and R2 with the App Worker.
3. **D1** (SQLite) — clients, builds, streams, assignments, and the access log.
4. **R2** — the build archives (DMG/zip). Zero egress on the free tier.
5. (optional) **Cloudflare Email Service** — the only email path for now, used via the admin Worker's `send_email` binding to send invite/re-issue links. Sending to arbitrary recipients requires the **Workers Paid plan** and an **onboarded sending domain** (DNS records); the free allotment is 3,000 emails/month within that plan. Without it, invites are copy-paste links (free, no domain). Other providers are not implemented and aren't planned for a while.

**Why two Workers.** On `workers.dev`, enabling Cloudflare Access protects the entire hostname — there's no reliable per-path gating there. The public routes must stay open for Sparkle, so the admin can't live on the same hostname. Splitting gives a fully public app Worker and a fully gated admin Worker; both bind the same D1 and R2, so they operate on one shared dataset. It's the same code deployed twice, switched by a `ROLE` var, so each Worker only mounts its own routes (the admin routes 404 on the public Worker — there is no ungated admin surface).

The pivotal design decision is unchanged: the App Worker **generates each user's appcast per request** from D1. Gating, re-download, streams, pinning, rollback, and revocation notices all fall out of that one resolver (§8). Both Workers are **host-agnostic**, deriving their origin from the incoming request, which is what lets them run on bare `*.workers.dev` URLs with no configuration.

```
   macOS app ──► /appcast?token=   ┌─────────────────────────┐
   (Sparkle)    /download?token=   │  App Worker (public)     │──┐
                                   │  • token gate, resolver  │  │
   User ──────► /get?token=        │  • binary stream         │  │   ┌── D1 (clients, builds,
   (browser)    landing page       └─────────────────────────┘  ├──►│   streams, access_log)
                                                                 │   └── R2 (build archives)
   Admin ─────► /admin             ┌─────────────────────────┐  │
   (Cloudflare  [Cloudflare Access]│  Admin Worker (gated)    │──┘
    Access)     ───────────────────│  • clients/builds/streams│
                                   │  • validates Access JWT  │──► Email provider (optional)
                                   └─────────────────────────┘
```

---

## 3. Hosting and portability

Each instance lives on the account's `workers.dev` subdomain as two hostnames:

```
App:    https://alpha-gate-<INSTANCE>.<account-subdomain>.workers.dev
Admin:  https://alpha-gate-<INSTANCE>-admin.<account-subdomain>.workers.dev
```

No custom domain, no DNS, no zone. `workers_dev = true` on both. Access is enabled only on the admin hostname.

**Multi-instance:** a single `INSTANCE` slug namespaces every resource, so one account holds as many independent instances as wanted.

| Resource | Naming |
|---|---|
| App Worker | `alpha-gate-${INSTANCE}` |
| Admin Worker | `alpha-gate-${INSTANCE}-admin` |
| D1 database | `alpha-gate-${INSTANCE}` (bound to both Workers) |
| R2 bucket | `alpha-gate-${INSTANCE}` (bound to both Workers) |
| Generated config / state | `.deploy/${INSTANCE}.*.toml`, `.deploy/${INSTANCE}.state.json` |

---

## 4. Auth model

Two separate audiences, two separate mechanisms.

**Alpha users — no login.** The per-user **token** is the credential, validated on every `/get`, `/appcast`, and `/download`. Users never authenticate interactively.

**Admin — Cloudflare Access.** The admin Worker's whole hostname sits behind a self-hosted Access application. For a single admin, the policy allowlists one email and uses **one-time PIN** as the identity method — Cloudflare emails a login code, so no external IdP or password is involved. Access Zero Trust is free for up to 50 users, so this stays within the free-tier goal. Day-to-day management is editing the email allowlist in the Cloudflare dashboard.

**Defense in depth.** The admin Worker also **validates the Access JWT** (`Cf-Access-Jwt-Assertion`) on every request — checking the signature against the team's `…cloudflareaccess.com/cdn-cgi/access/certs`, the audience (`aud`) of the Access app, and the email claim — and fails closed if it's missing or invalid. This protects against the Access app being accidentally disabled. The Worker needs two values for this, set after Access is created (§19): `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.

**Team-account note (answering the earlier question).** Access grants are governed by the **policy you attach, not by team membership** — a policy allowlisting one email admits only that email, even on a shared Zero Trust account. Teammates do not get the admin UI unless your policy includes them. The remaining caveat is account-level: anyone with Cloudflare **dashboard** access to the account can read D1/R2 directly or disable the Access app, which app auth cannot prevent. Install into a dedicated account if that isolation matters.

---

## 5. Data model

```sql
-- 0001_clients.sql
CREATE TABLE clients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  token           TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'revoked'
  pinned_build_id INTEGER,                          -- nullable; overrides stream resolution
  label           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_clients_token ON clients(token);

-- 0002_builds_streams.sql
CREATE TABLE builds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  short_version TEXT NOT NULL,                       -- human, e.g. '1.4.0'
  build_number  INTEGER NOT NULL UNIQUE,             -- machine CFBundleVersion, monotonic
  object_key    TEXT NOT NULL,                       -- R2 key of the archive
  ed_signature  TEXT NOT NULL,                       -- Sparkle EdDSA (from generate_appcast)
  length        INTEGER NOT NULL,
  min_os        TEXT,
  critical      INTEGER NOT NULL DEFAULT 0,          -- mandatory/critical update flag
  status        TEXT NOT NULL DEFAULT 'available',   -- 'available' | 'withdrawn'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE streams (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE                           -- e.g. 'stable', 'beta', 'canary'
);

CREATE TABLE build_streams (
  build_id  INTEGER NOT NULL REFERENCES builds(id),
  stream_id INTEGER NOT NULL REFERENCES streams(id),
  PRIMARY KEY (build_id, stream_id)
);

CREATE TABLE user_streams (
  client_id INTEGER NOT NULL REFERENCES clients(id),
  stream_id INTEGER NOT NULL REFERENCES streams(id),
  PRIMARY KEY (client_id, stream_id)
);

-- 0003_access_log.sql
CREATE TABLE access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER,
  email         TEXT,                                -- denormalized; survives client deletion
  event         TEXT NOT NULL,                       -- 'check' | 'download' | 'update'
  short_version TEXT,
  build_number  INTEGER,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_access_log_client  ON access_log(client_id);
CREATE INDEX idx_access_log_created ON access_log(created_at);

-- 0004_meta.sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,                            -- tool-update bookkeeping, etc.
  value TEXT
);

-- 0005_admin_audit.sql
CREATE TABLE admin_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT NOT NULL,                         -- from the Access JWT
  action      TEXT NOT NULL,                         -- e.g. 'client.revoke', 'build.withdraw', 'stream.assign'
  target      TEXT,                                  -- entity affected (email, build_number, stream)
  detail      TEXT,                                  -- JSON: params / before-after
  ip          TEXT,
  ray_id      TEXT,                                  -- Cloudflare Ray ID, to cross-reference platform logs
  prev_hash   TEXT,                                  -- hash of the previous row (chain)
  hash        TEXT NOT NULL,                         -- SHA-256(canonical(entry)); canonical includes prev_hash as its trailing field (see design/decisions/0005)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at);
```

Admin identity is handled by Cloudflare Access, so there is no credential table. Build metadata lives in D1 (not an R2 JSON) because the resolver queries by stream, status, and version order; the R2 object is just the archive bytes.

The access log distinguishes three events: **`check`** (Sparkle polled the feed; carries the app's installed `build_number`, sent as a feed parameter, giving each user's current version and last-seen time), **`download`** (the user fetched the binary from the landing page — first install or manual redownload), and **`update`** (Sparkle fetched an update via the appcast enclosure). The download/update split comes from a `via=install|update` marker on the `/download` URL (§6, §8). Per-user "last installed" / "last updated" and per-build download/update counts are simple `MAX`/`COUNT` queries over this table.

---

## 6. The user-facing link

Each user receives exactly **one** URL — a token-gated landing page on the App Worker:

```
https://<app-worker-host>/get?token=XYZ
```

The Worker validates the token and renders one small page carrying every action, in order:

1. **Download** button → `/download?token=XYZ&via=install` (serves the DMG; logged as a `download` event).
2. **Activate** button → `myapp://activate?token=XYZ` (deep link into the installed app).
3. The token shown as text, as a paste fallback.
4. Short instructions: download → install → launch → activate.

The page is itself token-gated; an invalid or revoked token returns a generic 404 (or the "request access" page), so token existence is not confirmed. The URL is durable: the user revisits it to re-download or re-activate while the token is active. With the email hybrid, a configured provider emails this URL; otherwise the admin copies it from the back office and sends it.

**Customizable template.** The page is a branded template: app name, a short blurb, an accent color, and an uploaded **app icon / header image**. Text config lives in the `meta` table; images are stored in R2 under `branding/` and served from a public `/assets/<name>` route on the App Worker. Admins edit this on the Download-page settings (§13). With nothing set, it renders a clean unbranded default.

---

## 7. Token lifecycle and delivery

**The token is never injected into the binary.** The Developer ID signature seals every file in the `.app` and notarization staples a ticket to it; embedding a token breaks the seal and would force per-user re-sign + re-notarize. macOS also does not tell an installed app what URL it was downloaded from, so the download token cannot reach the app on its own. The token therefore enters the app in a **separate activation step**:

Both delivery methods below are supported; they're app-side and Sparkle-agnostic — Sparkle never sees the token, it just consumes whatever feed URL the app configures via the `SPUUpdaterDelegate` feed-URL method. The app offers both so the user can use whichever works for them.

- **Deep link.** First launch finds no token in Keychain and shows an "activate" prompt. The user clicks `myapp://activate?token=XYZ` (registered via `CFBundleURLTypes`); the app captures the token, stores it in Keychain, and sets Sparkle's feed to `https://<app-host>/appcast?token=XYZ`. Ordering is enforced naturally — the scheme only resolves after install.
- **Paste.** The same first-launch screen has an "enter access key" field; the user pastes the token shown on the landing page / in the email. Identical end state.
- **Sidecar (zip distribution only).** The Worker can wrap the generic stapled `.app` with a `token.txt` beside it; the app reads it on first launch. Does not apply to DMG, and does not work for sandboxed apps. A convenience, not a primary path.

From activation onward, every Sparkle request carries the token and the appcast points downloads at `/download?token=XYZ`. The DMG and the feed share one gate and one key.

---

## 8. Update resolution (the core resolver)

For a request to `/appcast?token=T` (App Worker):

1. Look up the client by token. Unknown or `revoked` → return an **informational-only** update pointing at the access/renewal page (§15).
2. If `pinned_build_id` is set and that build is `available` → target = the pinned build.
3. Otherwise → target = the **highest `build_number` among `available` builds in any stream the client is assigned to**.
4. Emit an appcast `<item>`: `sparkle:version` = `build_number`, `sparkle:shortVersionString` = `short_version`, enclosure URL = `/download?token=T&via=update`, `sparkle:edSignature` and length from the build row, `sparkle:criticalUpdate` if `critical`.
5. Log a `check` event, recording the app's installed `build_number` (sent as a feed parameter) for current-version and last-seen stats.

Sparkle compares the item's `build_number` to the installed one and updates only if higher; the server never needs the installed version for resolution. `/download?token=T&via=…` validates the token, resolves the same target (or an explicit build for first install), streams the R2 object, and logs a **`download`** event for `via=install` or an **`update`** event for `via=update`.

---

## 9. Rollback (roll-forward, because Sparkle cannot downgrade)

Sparkle 2 does not support downgrades — an item whose version is below the installed version is not offered, by design (an unsigned feed makes forced downgrades a security risk). Pointing the appcast at a lower build errors on install or loops.

So "withdraw a bad version and move users back" is implemented as **rolling forward to old code**:

1. Rebuild the previous good release with a **higher `build_number`**, keeping its human `short_version` (e.g. still "1.4.0" while `build_number` jumps above the bad one). Sign, notarize, publish as a new build row.
2. Mark the bad build `withdrawn`.
3. The resolver serves the rollback build; Sparkle sees a higher number and installs it.

A rollback therefore requires producing that bumped artifact in the publish pipeline — not a pure server toggle. The server's role is to withdraw, retarget, and validate (§11).

---

## 10. Streams and pinning (admin control)

**Streams** are named release channels (`stable`, `beta`, `canary`). Builds belong to one or more streams; users are assigned one or more. The resolver serves the highest available build across a user's streams — done server-side, so Sparkle's own channel mechanism isn't needed.

Admin operations (all on the Admin Worker): create/delete streams; add/remove a build to/from streams; assign/unassign users to streams; pin/unpin a user to a specific build; withdraw/restore a build.

No-downgrade caveat applies to pin and stream moves: pinning below, or moving a user to a stream whose top build is lower than their installed build, won't take effect until a higher-numbered build is available there.

---

## 11. Server-side validation and the "no-build" state

A user is **servable** when the resolver (§8) yields a target: pinned to an `available` build, or has an `available` build in one of their streams. The negation is the **no-build state**, surfaced on the users list with an icon and a filter (§13). Two situations produce it:

- **Empty:** no `available` build in the user's streams (or pinned to a now-withdrawn build).
- **Stranded under no-downgrade:** the user is on a build that was withdrawn, and there is no `available` build numbered higher in their streams, so Sparkle cannot move them off it.

Admin actions that can create the no-build state — withdrawing a build, removing a build from a stream, unassigning a user, pinning to a withdrawn build — are **not blocked**. Instead they require **explicit confirmation**: the Worker computes which users would become no-build, lists them by email, and proceeds only on confirm. Those users then carry the no-build flag until the situation is resolved (publish a higher-numbered build, reassign streams, or unpin).

This replaces the earlier hard block: the operator can deliberately leave users without a build, but only knowingly, with the affected set shown up front and the state always visible afterward.

---

## 12. Critical user journeys

**1. First install.** Admin creates a client → gets `/get?token` (emailed or copy-pasted). User opens the page → downloads the DMG → installs and launches → app has no token, shows the activate prompt → user clicks the deep link (or pastes the token) → token saved to Keychain, Sparkle feed set → first check authenticates, reports up to date. Log: one `download`.

**2. Normal update.** Admin publishes a new build (higher number) into a stream the user is in. On Sparkle's next scheduled check, `/appcast?token` resolves it as the highest in the user's streams. Sparkle downloads via `/download?token&via=update`, verifies the EdDSA signature, installs on relaunch. Log: `check` + `update`.

**3. Redownload / reinstall.** On a new or wiped machine, the user revisits the same durable `/get?token` link → downloads the DMG → installs → re-activates with the same (still-active) token → Keychain restored. No admin action while the token is active.

**4. Forced / mandatory update.** Admin publishes a new build (higher number) and marks it `critical`. The resolver sets `sparkle:criticalUpdate`, so Sparkle prompts insistently and installs on relaunch rather than letting the user defer indefinitely. Same delivery path as a normal update and as rollback — only the critical flag differs. (Sparkle still can't install with zero interaction; critical + a short check interval is the closest to "forced.")

**5. Reissue a token.** Admin clicks re-issue → a new token replaces the old one on the client row → new `/get` link sent. The installed app still holds the old token, so its next `/appcast` check fails the lookup and the Worker returns an informational update ("re-activate your access"). The user opens the new `/get` link and re-activates via the deep link → Keychain updated → back to normal. The app self-heals; no reinstall.

**6. Revoke a token.** Admin revokes → `status = revoked`. Next `/appcast` returns the informational-only update directing to the renewal page; `/download` returns denied. Re-granting is a reissue + re-activate.

**7. Two–three update channels.** Admin defines `stable` and `beta`. User A is in `stable`; user B is in `stable` + `beta`. Build 1.4.0 (#1500) published to `stable`; build 1.5.0-beta (#1600) to `beta`. A resolves to #1500; B resolves to #1600 (highest across their streams). Moving B from `beta` to `stable` takes effect next check — though if #1600 > the top `stable` build, B holds at #1600 until a higher `stable` build ships (no-downgrade).

**8. Pinned version.** Admin pins user C to build #1500. The resolver always serves #1500 regardless of newer stream builds; C updates to it if higher, then holds. Unpin → C resumes stream resolution. Pinning below C's installed build won't apply until a higher-numbered target exists.

**9. Other useful journeys.**
- **Withdraw a bad version (rollback):** publish a roll-forward build (old code, higher number), withdraw the bad build; validation confirms affected users have a higher target; users move to it next check (§9, §11).
- **Admin onboarding:** after deploy, enable Cloudflare Access on the admin Worker and add your email to the policy (§19); log in via one-time PIN.
- **Audit:** admin views the client list and access log — who downloaded which version, when (§5).
- **Pause distribution:** withdraw the current top build (subject to §11) or revoke specific tokens.

### Operator / system-lifecycle journeys

**10. Initial install of the system.** Operator clones the repo, runs `wrangler login` once, then `./deploy/deploy.sh --instance <slug>`. The script provisions D1 + R2, applies migrations, and deploys both Workers, printing the app and admin URLs plus the one-time checklist (enable Access on the admin Worker + allowlist email, set `ACCESS_AUD`/`ACCESS_TEAM_DOMAIN`, publish the first build, optionally wire email). After the checklist the instance is live (§19).

**11. Second instance on the same account.** Re-run `./deploy/deploy.sh --instance <other-slug>`. Every resource is namespaced by the slug, so D1, R2, and both Workers are independent and nothing collides with the first instance. Each instance has its own admin URL and its own Access app; an operator running several repeats the per-instance checklist once each (§3, §19).

**12. Updating the system itself.** Each deployment carries its `TOOL_VERSION` and periodically checks an upstream release manifest. When a newer version exists, the admin page shows an update banner (and emails the operator if email is configured). To update: `git pull` the repo and re-run `./deploy/deploy.sh --instance <slug>` for each instance — the script is idempotent, so it reuses the existing D1/R2, applies any new migrations, and redeploys both Workers in place. Tokens, clients, builds, and logs are preserved (§22).

**13. Publishing via GitHub Actions.** A macOS CI job builds, signs (Developer ID), notarizes, staples, and runs `sign_update` for the EdDSA signature — all from secrets stored in GitHub (signing cert + password, notary API key, Sparkle EdDSA private key). It then runs the repo's portable `ci-publish.sh`, which uploads the archive and registers the build via the admin Worker's `/admin/builds/upload`, authenticating through Cloudflare Access with a **service token** (no interactive login). The admin CI page (§13) lists the exact secrets and a ready workflow snippet. Result: pushing a tagged release ships a new build into the chosen stream automatically (§20).

---

## 13. Routes and admin pages

**App Worker (`ROLE=app`, public).** Admin routes return 404 here.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/get?token=` | token | Token-gated landing page: download, activate, paste, instructions. |
| GET | `/appcast?token=` | token | Resolver (§8). Active → appcast item; revoked/unknown → informational update. Logs `check`. |
| GET | `/download?token=&via=` | token | Validate, stream the archive from R2. Logs `download` (`via=install`) or `update` (`via=update`). |
| GET | `/access` | none | Public "request access" page; target of revoked-user info link; submits a pending request. |
| GET | `/assets/*` | none | Public branding assets (e.g. the app icon) from R2; used by the `/get` page. |

**Admin Worker (`ROLE=admin`, behind Cloudflare Access + JWT).** Public routes return 404 here.

| Method | Path | Behavior |
|---|---|---|
| GET | `/admin` | Back office: clients, builds, streams, pins, logs. |
| POST | `/admin/clients` … `/revoke` `/reissue` `/pin` `/streams` | Client and assignment mutations; validated per §11. |
| POST | `/admin/builds/*` | Withdraw/restore builds, edit build↔stream links; validated per §11. |
| POST | `/admin/builds/upload` | Receive archive + EdDSA signature + metadata, store to R2, register the build row. Admin session or Access service token (CI). |
| POST | `/admin/branding` | Save download-page branding and the invite template; upload branding images to R2. |
| GET | `/admin/ci` | GitHub Actions setup instructions and the workflow snippet. |

Admin pages are server-rendered HTML; buttons are plain `<form>` POSTs. Every admin request validates the Access JWT (§4) before doing anything; every mutation also writes an `admin_audit` row (§5, §16).

### Admin pages (information architecture)

All on the admin Worker, behind Access.

1. **Add user.** Email, optional label, optional initial stream assignment. On submit, shows the copyable `/get` invite link (and emails it if a provider is configured).
2. **Users list.** Email; last installed and last updated timestamps; current version; assigned streams; pinned version; status. A **no-build icon** on affected rows and a **filter for "no available build"** (§11); also filter by stream, status, and pinned.
3. **Builds list.** Every uploaded version with a small stats summary (download count, update count, last activity) and the channels each build is available in. Bulk withdraw / mark critical.
4. **User management.** One user: assign/unassign streams, pin/unpin a build, revoke/reissue token (returns the new `/get` link), copy invite link, view that user's event history.
5. **Channels (streams) list.** All streams with build and user counts; create/delete a stream.
6. **Channel management.** One stream: builds in it (and current top build), users assigned; add/remove on both sides.
7. **Build management.** One build: versions, signature/length, status, critical flag; add/remove to/from streams; designate as a rollback target. Withdrawals that would strand users trigger the §11 confirmation.

**Added beyond the requested set (likely needed):**

8. **Dashboard (home).** Counts (active users, builds, streams), the self-update banner (§22), number of users in the no-build state, and a pending-requests badge — the entry point to everything above.
9. **Activity log.** The global `check` / `download` / `update` event feed (§16), filterable by user, version, and event type — the audit trail behind the per-user "last activity" and per-build counts.
10. **Pending access requests.** Submissions from the public "request a new key" page (§12, reissue/revoke), so the admin can re-issue and send a fresh link.
11. **Settings.** Email provider and from-address, Access/team info, tool version / self-update status (§22), and the editable **email invite template** (see Branding and templates below).
12. **Upload build (browser).** Upload an already-signed, notarized archive and paste its EdDSA signature; set short/build version, min OS, critical, and stream assignment. The Worker stores the archive in R2 and registers the build row — it never signs (§20). Subject to the request-size limit; very large builds use the CI/script path.
13. **Download page / branding.** Edit the public `/get` page: app name, blurb, accent color, and upload the app icon / header image (§6).
14. **CI / GitHub Actions setup.** Instructions plus the values CI needs — the Access **service token** (to reach the gated admin Worker non-interactively) and the macOS signing secrets — with a copy-paste workflow snippet (§20).
15. **Admin audit log.** Every admin mutation — create/revoke/reissue client, assign/unassign stream, pin, withdraw/restore build, upload, branding/template edit — with the acting admin's email (from the Access JWT), target, details, IP, and Cloudflare Ray ID. Filterable by actor and action. Distinct from the user-facing Activity log (§16), which is download/update events.

Builds are still produced (signed + notarized) on macOS; neither the browser upload nor CI changes that. What's new is that the *upload + registration* step can now happen from the browser or CI, not only from `publish.sh`. The Worker never holds a signing key.

### Branding and templates

- **Download-page branding** — `app_name`, `blurb`, `accent` color, and an icon/header image. Text config in `meta`; image in R2 (`branding/icon`), served at `/assets/icon` on the App Worker; rendered by `/get` (§6).
- **Email invite template** — an editable subject + body with placeholders, stored in `meta`, defaulting to:

```
Subject: You're invited to test {app_name}

Hi,

You've been added to the {app_name} alpha. To get started:

  1. Open your private download page:  {get_url}
  2. Download and install the app.
  3. Launch it, then click "Activate" on the page (or paste the key shown there).

That page is yours — revisit it any time to reinstall. It stops working if access is revoked.
```

Placeholders `{app_name}`, `{get_url}`, `{token}` are filled per recipient. The same template feeds copy-paste mode (rendered for the admin to send manually) and Cloudflare Email Service when configured.

---

## 14. Signing model (recap)

Three signatures, none performed by a Worker:
- **Developer ID + notarization** — on the `.app`, once per build; Gatekeeper checks the stapled ticket.
- **Sparkle EdDSA (`sparkle:edSignature`)** — signs the archive bytes, once per build via `generate_appcast`; the App Worker pastes the fixed string into every per-user appcast. Swapping the enclosure URL per token does not invalidate it.
- **Feed signature (`SURequireSignedFeed`)** — would sign the appcast document and force per-request signing (private key on the edge). **Off for alpha.** Per-archive EdDSA still prevents a tampered binary from installing.

---

## 15. Revocation notice via Sparkle

For revoked/unknown tokens, `/appcast` returns an **informational-only** update instead of a 403: an item with a higher `sparkle:version`, a `<link>` to the access page, and no enclosure. Sparkle shows a notice without an "Install and Relaunch" button, directing the user to renew. A bare 403 would only surface a generic error on manual checks and nothing on background checks.

---

## 16. Access log and security notes

- The access log is the source of truth for in-app distribution stats — download/update counts per build, per-user last activity — computed with simple `COUNT`/`MAX`. It records three events (`check` / `download` / `update`, §5) and is not a product-analytics system.
- **Admin actions are audited in-app.** Cloudflare's native Audit Logs only record changes to Cloudflare resources made via its API or dashboard — they do not see actions inside the Worker, so a token revocation in the UI never appears there. Cloudflare Access authentication logs record admin logins (who, when, IP) but not in-session actions. So the `admin_audit` table (§5), written by the admin Worker on every mutation and attributed to the Access JWT email, is the source of truth for admin actions; pair it with Access login logs for the full who-and-when, and store the Cloudflare Ray ID on each row to cross-reference. For an off-box copy, Logpush / Workers Logs can ship admin request logs to R2 or external storage.
- **Tamper-evident audit (hash chain + anchor).** The `admin_audit` rows are **hash-chained** — each stores `prev_hash` and `hash = SHA-256(canonical(entry))`, where the versioned canonical form embeds `prev_hash` as its trailing length-prefixed field (so prev_hash is bound into the hash without concatenation-boundary ambiguity; see `design/decisions/0005-audit-canonicalization.md` for the exact reproducible form) — so edits and mid-chain deletions break verification. A chain alone can't catch *truncation* (deleting the newest rows) or a full *rebuild*, so the daily cron **anchors** the current chain head (latest `hash` + row count) where the running admin can't silently rewrite it: into the bucket-locked R2 object and an email to the owner. Detection becomes a simple check — does the live chain extend the last anchored head? If it's shorter, diverged, or reset, something was tampered with since the last anchor.
- It holds light PII (email, IP, user-agent). The admin Worker is behind Access; optionally prune via a Cron Trigger: `DELETE FROM access_log WHERE created_at < datetime('now','-90 days')`.
- HTTPS end to end (appcast, release notes, downloads), per Sparkle.
- Keep the single gate uniform: never hand out raw R2 or pre-signed URLs for the DMG; route everything through `/download?token=` so logging and instant revocation hold.
- The admin routes do not exist on the public App Worker (`ROLE` gating), so there is no ungated admin surface even before Access is enabled.
- Feed-signing trade-off: with it off, a compromised Worker can't push a tampered binary (EdDSA guards that) but could redirect downloads or show a bogus notice. Acceptable for a private alpha; revisit before widening.
- Account-level access caveat for shared accounts (§4).

### Breach detection

The goal here is not to make a compromised account impossible — it's that if the account is hacked or lost, the owner can **detect that something happened and bound what was touched**, accepting that everything may then need to be treated as compromised. Three independent log sources cover that, and the two platform ones are outside an attacker's edit reach:

- **`admin_audit` (hash-chained, anchored)** — actions taken *through the app*; tamper-evident as above.
- **Cloudflare Audit Logs** — config and resource changes (Access policy edits, Worker redeploys, R2/D1 changes, key rotation). A serious attacker bypasses the app and acts here directly; Cloudflare manages these, so neither the owner nor an attacker using the owner's access can edit them.
- **Cloudflare Access authentication logs** — who logged in to the admin, when, and from where.

For "the account was hacked, what was done," the Cloudflare-managed logs are the more important half, since an attacker with account access need not touch the app at all. The hash chain protects the app-level record; the platform logs cover everything else and can't be rewritten from within the account. Practice: monitor for the anchored chain head diverging, and review the Cloudflare Audit and Access logs after any suspected compromise.

---

## 17. Repository layout

```
alpha-gate/
├── src/
│   └── worker.ts                 # one codebase; ROLE var selects app vs admin routes
├── VERSION                       # tool version, stamped into TOOL_VERSION at deploy
├── migrations/
│   ├── 0001_clients.sql
│   ├── 0002_builds_streams.sql
│   ├── 0003_access_log.sql
│   ├── 0004_meta.sql
│   └── 0005_admin_audit.sql
├── deploy/
│   ├── wrangler.template.toml    # §18 — rendered twice (app, admin)
│   ├── deploy.sh                 # §19 — one command, two Workers
│   └── teardown.sh
├── publish.sh                    # local macOS publish: build → sign → notarize → sign_update → upload + register
├── ci-publish.sh                 # portable: upload an already-built/signed archive + register (browser-less, for CI)
├── .github/
│   └── workflows/
│       └── publish.yml           # sample GitHub Actions workflow (macOS runner) calling ci-publish.sh
├── templates/
│   └── invite-email.txt          # default email invite template (§13)
├── test/                         # vitest-pool-workers suites (§23); `npm test` runs offline
│   └── vitest.config.ts
└── .deploy/                      # generated per-instance config + state (gitignored)
```

`worker.ts` reads `env.ROLE`: `app` mounts the public routes (§13) and 404s `/admin/*`; `admin` mounts the admin routes, validates the Access JWT, and 404s the public routes.

---

## 18. Wrangler config template

One template, rendered twice with different `NAME` and `ROLE`. Both Workers bind the same D1 and R2. No hostname or route — Workers derive their origin from requests; `workers_dev = true` exposes them.

```toml
# deploy/wrangler.template.toml
name = "${NAME}"
main = "../src/worker.ts"
compatibility_date = "2025-01-01"
workers_dev = true

[[d1_databases]]
binding = "DB"
database_name = "alpha-gate-${INSTANCE}"
database_id = "${D1_ID}"

[[r2_buckets]]
binding = "BUILDS"
bucket_name = "alpha-gate-${INSTANCE}"

[vars]
INSTANCE = "${INSTANCE}"
ROLE = "${ROLE}"                       # "app" | "admin"
EMAIL_PROVIDER = "${EMAIL_PROVIDER}"   # "none" | "cloudflare"
EMAIL_FROM = "${EMAIL_FROM}"           # for cloudflare: an address on the onboarded sending domain
TOOL_VERSION = "${TOOL_VERSION}"
UPDATE_MANIFEST_URL = "${UPDATE_MANIFEST_URL}"

# Admin Worker only: Cloudflare Email Service binding (used when EMAIL_PROVIDER = "cloudflare").
# Requires Email Routing enabled + a sending domain onboarded; needs Workers Paid for arbitrary recipients.
[[send_email]]
name = "EMAIL"

[triggers]
crons = ["0 12 * * *"]                 # daily self-update check; admin Worker acts, app Worker no-ops

# Admin-Worker secrets/vars, set after Access is enabled (§19):
#   ACCESS_TEAM_DOMAIN  — e.g. yourteam.cloudflareaccess.com
#   ACCESS_AUD          — the Access application's AUD tag
# (Cloudflare email uses the send_email binding above — no API key needed.)
```

---

## 19. Deployment — installable by anyone

Goal: run one script, get a working instance; anything a script can't do is printed as an explicit checklist. Deployment itself is **pure wrangler** — no Cloudflare API token, no DNS, no zone. Enabling Access is a one-time dashboard step (Access app creation isn't cleanly scriptable without an API token), which fits the printed-instructions fallback.

### Prerequisites
- `node` + `wrangler` (`wrangler login` once), `jq`, `envsubst`.
- macOS only for `publish.sh` (signing/notarization), not for deployment.

### Parameters

| Flag | Required | Meaning |
|---|---|---|
| `--instance` | yes | Slug namespacing all resources |
| `--email-provider` | no | `cloudflare`, or omit for copy-paste invites (only Cloudflare is implemented) |
| `--email-from` | no | Sender address on your onboarded sending domain (required if `--email-provider cloudflare`) |

### `deploy/deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

EMAIL_PROVIDER="none"; EMAIL_FROM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance)        INSTANCE="$2"; shift 2;;
    --email-provider)  EMAIL_PROVIDER="$2"; shift 2;;  # "cloudflare" or omit
    --email-from)      EMAIL_FROM="$2"; shift 2;;
    *) echo "unknown flag: $1" >&2; exit 1;;
  esac
done
: "${INSTANCE:?--instance is required}"

RES="alpha-gate-${INSTANCE}"
TOOL_VERSION=$(cat VERSION 2>/dev/null || echo "0.0.0")
UPDATE_MANIFEST_URL="${UPDATE_MANIFEST_URL:-https://raw.githubusercontent.com/your-org/alpha-gate/main/release.json}"
mkdir -p .deploy

# 1. D1 (create if absent, capture id)
D1_ID=$(wrangler d1 list --json | jq -r --arg n "$RES" '.[]|select(.name==$n)|.uuid' || true)
if [[ -z "$D1_ID" || "$D1_ID" == "null" ]]; then
  wrangler d1 create "$RES" >/dev/null
  D1_ID=$(wrangler d1 list --json | jq -r --arg n "$RES" '.[]|select(.name==$n)|.uuid')
fi

# 2. R2 (create if absent)
wrangler r2 bucket list | grep -q "^${RES}\b" || wrangler r2 bucket create "$RES" >/dev/null

# 3+4. render config + apply migrations once (against shared DB)
render() { # role -> writes .deploy/<instance>.<role>.toml
  local ROLE="$1" NAME="$2"
  export INSTANCE D1_ID EMAIL_PROVIDER EMAIL_FROM ROLE NAME TOOL_VERSION UPDATE_MANIFEST_URL
  envsubst < deploy/wrangler.template.toml > ".deploy/${INSTANCE}.${ROLE}.toml"
}
render app   "${RES}"
render admin "${RES}-admin"
wrangler d1 migrations apply "$RES" --config ".deploy/${INSTANCE}.app.toml" --remote

# 5. deploy both Workers, capture URLs
APP_URL=$(wrangler deploy --config ".deploy/${INSTANCE}.app.toml"   | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -n1)
ADM_URL=$(wrangler deploy --config ".deploy/${INSTANCE}.admin.toml" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -n1)

# 6. state + checklist
jq -n --arg i "$INSTANCE" --arg a "$APP_URL" --arg m "$ADM_URL" --arg d "$D1_ID" \
  '{instance:$i, app_url:$a, admin_url:$m, d1_id:$d}' > ".deploy/${INSTANCE}.state.json"

cat <<EOF

Deployed:
  App   (public) → ${APP_URL}     # users + Sparkle
  Admin (gated)  → ${ADM_URL}     # back office

Finish setup (manual, one-time):
  1. Protect the admin Worker with Cloudflare Access:
       Dashboard → the "${RES}-admin" Worker → Settings → Domains & Routes
       → enable "Cloudflare Access", then add your email to the policy (one-time PIN).
  2. Tell the admin Worker its Access identity (for JWT validation):
       wrangler secret put ACCESS_TEAM_DOMAIN --config .deploy/${INSTANCE}.admin.toml   # yourteam.cloudflareaccess.com
       wrangler secret put ACCESS_AUD         --config .deploy/${INSTANCE}.admin.toml   # the app's AUD tag
       wrangler deploy --config .deploy/${INSTANCE}.admin.toml
  3. Publish the first build (on macOS):  ./publish.sh --instance ${INSTANCE}
  4. Email (v1, Cloudflare Email Service): to send invite links to arbitrary users,
       - upgrade the account to Workers Paid,
       - enable Email Routing and onboard a sending domain (add the DNS records Cloudflare prescribes),
       - re-run deploy with: --email-provider cloudflare --email-from alpha@<your-sending-domain>
     Without this, invites are copy-paste links from the admin page (free, no domain).

EOF
```

The infrastructure is fully automatic; the checklist covers exactly what a script can't: create the Access app (dashboard), feed its AUD back to the Worker, produce a signed/notarized build (macOS), and optionally wire email. A second instance is just another `--instance`.

---

## 20. Publishing a build

Producing a build always happens on **macOS** — build → sign (Developer ID) → notarize → staple → archive (DMG for first install; `.app` zip for Sparkle) → `sign_update` for the EdDSA signature + length. The Worker never signs and never holds the EdDSA private key.

Only the **upload + registration** step varies, and all three paths converge on one endpoint, `POST /admin/builds/upload` (archive + EdDSA signature + version/build_number/min_os/critical + stream assignment), which stores the archive in R2 and inserts the `builds` row:

1. **Local script** — `publish.sh` runs the macOS steps and uploads, authenticating with the admin's session or a service token. Default for a solo dev.
2. **Browser** — the Upload-build page (§13) for an already-signed archive; paste the EdDSA signature and pick streams. Subject to the request-size limit; large builds use path 1 or 3.
3. **GitHub Actions** — `ci-publish.sh` on a macOS runner, authenticating to the gated admin Worker with a Cloudflare Access **service token** (added to the admin Worker's Access policy as a Service Auth rule). CI secrets: Developer ID cert + password, notary API key, Sparkle EdDSA private key, and the service token's client id/secret. The admin **CI page** (§13) prints these and a workflow snippet.

For archives that exceed the Worker request-size limit, upload the binary straight to R2 (a Cloudflare API token with R2 write) and call a metadata-only `register` variant of the endpoint.

For a **rollback build**, build the previous code with a bumped `build_number` and publish it by any path (§9).

---

## 21. Teardown

`deploy/teardown.sh --instance <slug>` reads the state file and removes both Workers, empties and deletes the R2 bucket, and deletes the D1 database (destructive — prompt for confirmation). The Access app is removed from the dashboard. Everything is namespaced, so other instances are untouched.

---

## 22. Self-update notifications

Alpha Gate is self-hosted, so each installation needs to learn when a newer version of *the tool itself* (not the macOS app it distributes) is available and that the operator should redeploy.

**Version stamping.** Each deployment is stamped with `TOOL_VERSION`, a `[vars]` value the deploy script reads from the repo's `VERSION` file. This is the running tool version.

**Upstream manifest.** The project publishes a small JSON at a stable URL — `UPDATE_MANIFEST_URL`, defaulting to the repo's raw `release.json`:

```json
{ "latest": "1.3.0", "min_supported": "1.1.0", "notes_url": "https://.../releases/1.3.0", "breaking": false }
```

Forks can repoint it or disable the check.

**Check and notify.** A daily Cron Trigger on the admin Worker (free tier) fetches the manifest, compares `latest` to `TOOL_VERSION`, and stores the result in the `meta` table. The admin page renders an **update banner** when `latest > TOOL_VERSION`, with the notes link and a breaking-change flag. If an email provider is configured, the cron emails the operator **once per new version** — deduped via `meta.last_notified_version` so it doesn't nag daily. The app Worker shares the cron config but no-ops it (only `ROLE=admin` runs the check).

**Applying the update** is operator-driven and idempotent: `git pull`, then re-run `deploy.sh --instance <slug>` per instance. Migrations apply, both Workers redeploy, and all data is preserved (journey 12).

**Multi-instance:** each instance checks and banners independently against its own `TOOL_VERSION`, so an operator running several sees the banner in each admin page until each is updated.

---

## 23. Testing

The system is fully unit- and integration-testable locally, with **no real Cloudflare account and no network**, using `@cloudflare/vitest-pool-workers`. Tests run inside the same `workerd` runtime as production, with Miniflare simulating the bindings — D1, R2, KV, cron — with **isolated per-test storage** (writes undone between tests) and **declarative outbound `fetch` mocking**. The `fetch()` and `scheduled()` (cron) handlers are invoked directly, so routing, the resolver, the self-update check, and the audit anchor are all exercised in tests.

Design for testability — keep I/O at the edges, logic pure:
- **Pure core functions** (no bindings): the resolver (§8) `resolve(client, builds, streams) → target | informational | none`; the no-build computation and §11 validation; the audit **hash-chain** build/verify; appcast XML generation. These are plain functions over plain data — most of the logic, testable with zero runtime.
- **Data layer over D1**: a thin query module; integration tests seed a local D1 (migrations applied via the test helper) and assert end to end.
- **R2**: tests assert the app writes the right append-only objects/keys; bucket-lock *enforcement* is infra, not app logic, so it's out of unit scope.

Things Miniflare doesn't simulate, handled with seams:
- **Cloudflare Access JWT** — no Access locally, so verification sits behind an injectable verifier. Tests sign a token with a throwaway keypair and point the verifier at a stub JWKS to exercise authorized / unauthorized / wrong-audience / service-token paths.
- **Email** — the `send_email` binding is simulated locally (captured, not sent), and the sender sits behind an interface so tests assert "an invite for X was composed" without a provider.
- **Outbound HTTP** — the self-update manifest fetch and any external email provider use `fetch`, mocked per test.

Out of unit scope (covered other ways):
- **Deploy/CI bash scripts** — `shellcheck` plus a `--dry-run` mode that mocks `wrangler`.
- **Sparkle client / macOS signing / notarization** — the Swift app and Apple toolchain; the Worker side is exercised by asserting the appcast XML and `/download` behavior the client consumes.
- **Bucket-lock and Access policy enforcement** — real-infra checks against a throwaway instance, not unit tests.

Beta caveats: coverage uses Istanbul (not V8), and Vitest fake timers don't apply to the KV/R2 simulators — use seeded timestamps for time-dependent tests (log pruning, self-update cadence). Repo: a `test/` directory with `vitest.config.ts` using `poolOptions.workers`; `npm test` runs everything offline.

---

## 24. Decisions (resolved)

- **First-install token delivery** — **both deep link and paste** are supported, offered side by side on the first-launch screen. Both are app-side and Sparkle-agnostic (§7); sidecar stays a zip-only convenience.
- **Email** — **Cloudflare Email Service only** (Workers Paid + onboarded sending domain). Copy-paste links are the free, no-domain default until that's set up. No other providers are implemented or planned for now.
- **Feed signing** — **off**. It's in architectural tension with the per-user dynamic feed (would require the signing key on the edge), and the per-archive EdDSA signature already blocks tampered binaries. The residual metadata-manipulation risk is bounded and covered by HTTPS, EdDSA, and breach detection (§16). Revisit only for a wider/public release, where the path is signed static feeds — which trades away per-user feeds (§14).
