# Operating Alpha Gate

A practical runbook for installing, publishing to, and operating an Alpha Gate instance. For the
architecture and rationale see [`../design/DESIGN.md`](../design/DESIGN.md); for the quick start see the
[README](../README.md).

> **Operational model.** The Worker — public app, gated admin, audit, cron — is complete and tested.
> - **Human admin tasks** (invite, revoke, reissue, pin, channels, build withdraw/restore/critical,
>   upload, branding) are done from the **back-office UI**, authenticated by your Cloudflare Access
>   browser session: open the admin URL and use the forms/buttons on each page.
> - **CI publishing** works headlessly over curl via a Cloudflare Access **service token** (the only
>   credential allowed on the upload/register routes).
> - The endpoint reference below documents what each form posts to, for scripting or curl.

## Contents
- [Prerequisites](#prerequisites)
- [Deploy](#deploy)
- [Enable Cloudflare Access](#enable-cloudflare-access)
- [Create a release channel](#create-a-release-channel)
- [Invite a user](#invite-a-user)
- [Publish a build](#publish-a-build)
- [Endpoint reference](#endpoint-reference)
- [Common admin tasks](#common-admin-tasks)
- [Rollback](#rollback)
- [Self-update notifications](#self-update-notifications)
- [Audit & breach detection](#audit--breach-detection)
- [Multiple instances](#multiple-instances)
- [Teardown](#teardown)
- [Known gaps](#known-gaps)

## Prerequisites

- Node ≥ 20, npm; `jq` and `envsubst` (GNU gettext); a Cloudflare account.
- `npm install`, then `npx wrangler login` once.
- macOS only for `publish.sh` (Apple signing/notarization).

## Deploy

```bash
./deploy/deploy.sh --instance myalpha          # provision + deploy both Workers (idempotent)
./deploy/deploy.sh --instance myalpha --dry-run # rehearse with wrangler mocked (no account touched)
```

It creates the D1 database and R2 bucket if absent, renders `.deploy/myalpha.{app,admin}.toml` from the
template, applies migrations, deploys both Workers, writes `.deploy/myalpha.state.json`, and prints the
app + admin URLs and the one-time checklist. **Re-run it to update in place** after `git pull` — D1/R2
are reused, pending migrations applied, both Workers redeployed; tokens/clients/builds/logs are
preserved. The `--instance` slug must be lowercase letters, digits, and hyphens.

The script checks its prerequisites (`jq`, `envsubst`, and — outside `--dry-run` — `npx`) before doing
anything. To enable email add `--email-provider cloudflare --email-from alpha@<your-domain>`;
`--email-from` is **required** in that mode (delivery would silently fail without a verified sender).
The Cloudflare Email Service binding is rendered onto the **admin Worker only**, never the public app.

## Enable Cloudflare Access

The admin URL is public until you put Cloudflare Access in front of it.

1. Dashboard → **Workers & Pages** → the `alpha-gate-myalpha-admin` Worker → **Settings → Domains &
   Routes** → enable **Cloudflare Access**. Cloudflare creates a self-hosted Access application for the
   admin hostname.
2. Edit the Access **policy**: action *Allow*, include **Emails** → your email. Identity method:
   **One-time PIN** (Cloudflare emails a login code — no external IdP).
3. Tell the Worker its Access identity so it can verify the JWT itself (defense-in-depth):
   - `ACCESS_TEAM_DOMAIN` = your team domain, e.g. `yourteam.cloudflareaccess.com` (Zero Trust →
     Settings → Custom Pages / team domain).
   - `ACCESS_AUD` = the Access application's **Application Audience (AUD) Tag** (Access → Applications →
     your app → Overview).
   ```bash
   npx wrangler secret put ACCESS_TEAM_DOMAIN --config .deploy/myalpha.admin.toml
   npx wrangler secret put ACCESS_AUD         --config .deploy/myalpha.admin.toml
   npx wrangler deploy --config .deploy/myalpha.admin.toml
   ```

The Worker fails **closed**: with these unset, every admin request is rejected.

For **CI publishing**, also add a **Service Auth** rule to the same Access application and create a
**service token**; its Client ID/Secret become `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` for
`ci-publish.sh`. Service tokens are accepted **only** on the build upload/register routes.

## Create a release channel

Users and builds are attached to named channels (e.g. `stable`, `beta`). Create them on the **Channels**
page (the *Add channel* form), or `POST /admin/streams` with `name`. Deleting a channel that would
leave users with no build is confirmed (§11) before it proceeds.

## Invite a user

`POST /admin/clients` (human session) with `email`, optional `label`, optional `streamId`. It creates
the client, optionally assigns the channel, records an audit row, and responds with the user's private
`/get?token=` link (and emails it if Cloudflare email is configured). Send that one link to the user;
it's durable — they revisit it to re-download or re-activate while the token is active.

## Publish a build

Build on macOS (build → sign Developer ID → notarize → staple → archive → `sign_update` for the Sparkle
EdDSA signature). The Worker never signs. Then upload + register via one of:

**Local (solo dev):**
```bash
./publish.sh --instance myalpha --stream-id 1
# fill in the marked app-specific build block in publish.sh for your project first
```

**CI (service token):**
```bash
export CF_ACCESS_CLIENT_ID=...  CF_ACCESS_CLIENT_SECRET=...
./ci-publish.sh \
  --admin-url https://alpha-gate-myalpha-admin.<account>.workers.dev \
  --archive dist/MyApp.zip --short-version 1.4.0 --build-number 1500 \
  --ed-signature "<sparkle:edSignature>" --stream-id 1
```

**Large archives (> ~90 MB):** PUT the archive to R2 out of band (a Cloudflare API token with R2 write),
then register metadata-only — the Worker HEADs the object and rejects a length mismatch:
```bash
./ci-publish.sh --admin-url ... --object-key build/1500/MyApp.zip --size 123456789 \
  --short-version 1.4.0 --build-number 1500 --ed-signature "..." --stream-id 1
```

`build_number` is the machine-comparable monotonic key (Sparkle's `sparkle:version`); `short_version`
is the human string. Add `--critical` to mark a mandatory update.

## Endpoint reference

All `/admin/*` routes require a valid Cloudflare Access identity. Mutations require a **human** session
unless noted **[svc-ok]** (a service token is also accepted there).

**Public (App Worker):**

| Method | Path | Notes |
|---|---|---|
| GET | `/get?token=` | Token-gated landing page. |
| GET | `/appcast?token=&installed=` | Per-user Sparkle feed; logs a `check`. |
| GET | `/download?token=&via=install\|update` | Streams the archive; logs `download`/`update`. |
| GET | `/assets/:name` | Public branding (`icon`, `header`). |
| GET | `/access` | Request-access page (submission handler is a follow-up). |

**Admin — pages (GET):** `/admin` (dashboard), `/admin/users`, `/admin/users/:id` (manage),
`/admin/builds`, `/admin/builds/:id` (manage), `/admin/streams`, `/admin/upload`, `/admin/settings`,
`/admin/activity`, `/admin/audit`.

**Admin — channel mutations (POST, human):** `/admin/streams` (`name`),
`/admin/streams/:id/delete` (+ `confirm=true` if it would strand).

**Admin — client mutations (POST, human):**

| Path | Form fields |
|---|---|
| `/admin/clients` | `email`, `label?`, `streamId?` → returns the `/get` link |
| `/admin/clients/:id/revoke` | — |
| `/admin/clients/:id/reissue` | — → returns a new `/get` link |
| `/admin/clients/:id/pin` | `buildId` (+ `confirm=true` if it would strand) |
| `/admin/clients/:id/unpin` | (+ `confirm=true` if it would strand) |
| `/admin/clients/:id/streams/assign` | `streamId` |
| `/admin/clients/:id/streams/unassign` | `streamId` (+ `confirm=true` if it would strand) |

**Admin — build mutations (POST, human):**

| Path | Form fields |
|---|---|
| `/admin/builds/:id/withdraw` | (+ `confirm=true` if it would strand) |
| `/admin/builds/:id/restore` | — |
| `/admin/builds/:id/critical` | `critical=true\|false` |
| `/admin/builds/:id/streams/link` | `streamId` |
| `/admin/builds/:id/streams/unlink` | `streamId` (+ `confirm=true` if it would strand) |
| `/admin/branding` | `app_name?`, `blurb?`, `accent?`, `invite_subject?`, `invite_body?`, `icon?` (png/jpeg/webp), `header?` |

**Admin — publish (POST) [svc-ok]:** `/admin/builds/upload` (multipart: `archive` + metadata),
`/admin/builds/register` (metadata: `object_key`, `size`, + version fields).

Any action that would leave a user with no available build (withdraw, unlink, unassign, pin/unpin to/off
an unavailable target) is **not blocked** — the endpoint returns a confirmation page listing the affected
emails, and you re-POST with `confirm=true` to proceed (§11).

## Common admin tasks

- **Revoke** a user → `POST /admin/clients/:id/revoke`. Their next `/appcast` returns the informational
  "reactivate" notice and `/download` is denied. Re-granting is a reissue.
- **Reissue** a token → `POST /admin/clients/:id/reissue`; send the new `/get` link. The app self-heals
  on re-activation — no reinstall.
- **Move a user between channels** → `…/streams/assign` then `…/streams/unassign`.
- **Pin** a user to a build → `…/pin` with `buildId`; **unpin** to resume channel resolution.
- **Mark an update critical** → `/admin/builds/:id/critical` with `critical=true`.
- **Branding** → `POST /admin/branding` (app name, blurb, accent, icon, and the invite email template).

## Rollback

Sparkle can't downgrade, so "withdraw a bad version" is a **roll-forward**:

1. Rebuild the previous good code with a **higher** `build_number` (keep the human `short_version`).
   Publish it as a new build into the affected channel.
2. `POST /admin/builds/:bad-id/withdraw`. Because the higher build is available, no one is stranded and
   it applies immediately; clients move to the roll-forward build on their next check.

## Self-update notifications

Each deployment is stamped with `TOOL_VERSION` (from `VERSION`) and a daily cron checks
`UPDATE_MANIFEST_URL` (default: the repo's `release.json`). When a newer version exists, the admin
dashboard shows a banner — noting **breaking changes** and a **release-notes link** when the manifest
supplies them — and a separate warning if the running version is **below `min_supported`**. If email
is configured, the operator is emailed once per version (with the notes link). To update: `git pull`
and re-run `deploy.sh --instance <slug>`. Forks repoint or disable the manifest.

**`release.json`** is the manifest this project publishes for its *own* self-update: `latest`,
`min_supported`, `notes_url`, `breaking`. Keep `latest` in sync with `VERSION` on each release, and
set `breaking` / bump `min_supported` when an upgrade needs manual steps. `notes_url` is treated as
untrusted — only `http(s)` links are surfaced.

## Audit & breach detection

- The **admin audit log** (`/admin/audit`) is hash-chained and anchored daily to an append-only R2
  object (and emailed to the owner). If the live chain diverges from the last anchor — an edit,
  truncation, or rebuild — the anchor flags it and stops trusting the tampered head.
- Pair it with Cloudflare's **Access authentication logs** (who logged in) and **Audit Logs** (config/
  resource changes), which an attacker with account access cannot rewrite. See `design/DESIGN.md` §16.

## Multiple instances

Re-run `./deploy/deploy.sh --instance <other-slug>`. Every resource is namespaced by the slug, so D1,
R2, both Workers, and `.deploy/<slug>.*` are independent. Each instance gets its own admin URL and its
own Access application; repeat the one-time checklist per instance.

## Teardown

```bash
./deploy/teardown.sh --instance myalpha           # prompts for confirmation
./deploy/teardown.sh --instance myalpha --dry-run # rehearse
```

Removes both Workers, the D1 database, and the R2 bucket for that slug (other instances untouched), and
deletes the local `.deploy/<slug>.*` files. **Remove the Cloudflare Access application from the dashboard
separately.** If the R2 bucket is non-empty the delete is reported (not silently skipped) — empty it via
the dashboard or `wrangler r2 object delete`, then re-run.

## Known gaps

These are tracked follow-ups; the underlying behavior they'd expose is implemented and tested.

- **`POST /access`** (the request-access form submission and the pending-requests queue) is not handled
  yet; the `/access` page renders but submitting it has no effect.
- **Cloudflare Email Service** delivery is behind the `EmailSender` seam but not implemented; invites are
  copy-paste links shown in the admin UI (the free-tier default).
