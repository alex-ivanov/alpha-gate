# Onboarding — prepare Cloudflare and run an instance

How to stand up an Alpha Gate instance from a fresh Cloudflare account. When you're done you'll have a
public app URL (the Sparkle feed) and a gated admin URL (the back office). To then ship builds, see
[UPLOADING](UPLOADING.md).

- [1. Prerequisites](#1-prerequisites)
- [2. Prepare your Cloudflare account](#2-prepare-your-cloudflare-account)
- [3. Deploy](#3-deploy)
- [4. Lock the admin behind Cloudflare Access](#4-lock-the-admin-behind-cloudflare-access)
- [5. (CI only) create a service token](#5-ci-only-create-a-service-token)
- [6. Verify](#6-verify)
- [7. Email (optional)](#7-email-optional)
- [Backup & recovery](#backup--recovery)
- [Multiple instances](#multiple-instances)
- [Updating in place](#updating-in-place)
- [Teardown](#teardown)
- [Troubleshooting](#troubleshooting)

## 1. Prerequisites

- **Node ≥ 20** and **npm**. The deploy/teardown/dev commands are a TypeScript CLI run via `tsx`, so
  `npm install` is the only setup — no `jq`/`envsubst`.
- A **Cloudflare account** (the free tier is enough).
- **macOS** is only needed to *publish builds* (Apple signing/notarization), not to deploy.

```bash
git clone <your-fork> alpha-gate && cd alpha-gate
npm install
```

## 2. Prepare your Cloudflare account

There is almost nothing to pre-create — `deploy.sh` provisions the D1 database and R2 bucket for you.
You only need:

1. **An account.** Sign up at cloudflare.com; the free tier covers Workers, D1, and R2.
2. **Authenticate wrangler once:**
   ```bash
   npx wrangler login        # opens a browser; grants this machine access to your account
   ```
   (For CI, set `CLOUDFLARE_API_TOKEN` instead of an interactive login.)
3. *(Recommended)* **Use a dedicated account.** Anyone with dashboard access to the account can read D1/R2
   directly, including live tokens — isolate Alpha Gate in its own account if that matters to you.

You do **not** need a custom domain, DNS, or an API token for deployment. Everything runs on
`*.workers.dev`.

## 3. Deploy

```bash
./deploy/deploy.sh --instance myalpha              # provision + deploy both Workers (idempotent)
./deploy/deploy.sh --instance myalpha --dry-run    # rehearse with wrangler mocked (touches nothing)
```

The `--instance` slug (lowercase letters, digits, hyphens) namespaces everything. The CLI runs a
read-only **preflight** (Node ≥ 20, wrangler auth) with a `→` fix line on any failure, an **inspect**
pass (which resources exist), shows the exact commands, then on confirm creates D1 + R2, applies
migrations, deploys both Workers, writes `.deploy/myalpha.state.json`, and prints:

- the **app URL** (`https://alpha-gate-myalpha.<account>.workers.dev`) — your Sparkle feed host;
- the **admin URL** (`…-myalpha-admin.<account>.workers.dev`) — the back office;
- a one-time checklist (the two steps below).

**First init is guided:** anything you don't pass is prompted (press Enter for the default) and seeded so
`/get` is correct immediately — your app name, the **activate URL scheme** (your macOS app's URL scheme,
must match its Info.plist `CFBundleURLSchemes`), and optional blurb/accent. Flags: `--app-name`,
`--activate-scheme`, `--blurb`, `--accent`. After first init the admin **Settings** page owns these.

## 4. Lock the admin behind Cloudflare Access

The admin URL is **public until you do this** — it's the one genuinely manual step (a Zero Trust
dashboard action; there's no wrangler command for it).

> **First time in Zero Trust?** Cloudflare makes you pick a **team name** and, even on the **free**
> Zero Trust plan, add a **payment method** before you can create Access applications (you are not
> charged on the free plan, which covers up to 50 users). Do this once at dash.cloudflare.com → Zero
> Trust before the steps below, so you're not stuck mid-deploy.

1. Dashboard → **Workers & Pages** → the `alpha-gate-myalpha-admin` Worker → **Settings → Domains &
   Routes** → enable **Cloudflare Access**. Cloudflare creates a self-hosted Access application for the
   admin hostname.
2. Edit that application's **policy**: action **Allow**, include **Emails** → your email. Identity method
   **One-time PIN** (Cloudflare emails a login code — no external IdP). Access Zero Trust is free for up
   to 50 users.
3. Grab two values and feed them back to deploy, which sets the secrets and redeploys for you:
   - **Team domain** — Zero Trust → Settings → team domain, e.g. `yourteam.cloudflareaccess.com` (the
     bare domain, no `https://`).
   - **AUD tag** — Access → Applications → your app → Overview → Application Audience (AUD).
   ```bash
   ./deploy/deploy.sh --instance myalpha \
     --access-team-domain yourteam.cloudflareaccess.com --access-aud <AUD>
   ```

The Worker verifies the JWT itself and **fails closed**: with these secrets unset, every admin request is
rejected. Now open the admin URL in a browser, log in with the one-time PIN, and you're in.

## 5. (CI only) create a service token

Skip this if you'll publish from your Mac with `publish.sh`. For headless CI publishing,
the script needs to reach the gated admin non-interactively:

1. Zero Trust → **Access → Service Auth → Create service token**. Copy the **Client ID** and **Client
   Secret** (the secret is shown once).
2. On the admin Access **application**, add a **second policy** with **Action: Service Auth** that
   includes that token. An email/one-time-PIN policy alone does **not** admit service tokens — without
   this, the token is redirected to the login page (an HTTP 302) and publishing fails.
3. Provide the pair to CI as `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`.

On macOS, `publish.sh` stores the token in your **login Keychain** on first use, so you enter it once
(see [UPLOADING](UPLOADING.md)). Service tokens are accepted **only** on the upload/register routes.

## 6. Verify

- **Admin loads:** open the admin URL, log in (one-time PIN), land on the Overview — the serving map shows each channel and what it offers (empty until you publish).
- **Public app loads:** the app URL's `/get` without a token returns a generic 404 (no token = nothing
  leaked); that's expected. After you invite yourself and publish a build (UPLOADING), the `/get?token=`
  link works end to end.
- **Settings page** shows the instance, the email status, and your Access team/AUD — a quick sanity check
  that the secrets landed.

## 7. Email (optional)

Out of the box, invites are **copy-paste links** shown in the admin UI (free, no domain). To send them
automatically you need Cloudflare Email Service, which requires **Workers Paid + a real, onboarded
sending domain** (you add SPF/DKIM DNS to a zone you control). Then:

```bash
./deploy/deploy.sh --instance myalpha --email-provider cloudflare --email-from alpha@<your-domain>
```

**A `*.workers.dev` hostname cannot be that sending domain** — you don't control its DNS. With no custom
domain, stay on copy-paste; the Settings page has a **Send test email** button to debug delivery once
configured. See the email section in [PRINCIPLES](PRINCIPLES.md#email).

## Multiple instances

Re-run with another slug: `./deploy/deploy.sh --instance <other>`. Every resource (D1, R2, both Workers,
the Access application, `.deploy/<slug>.*`) is independent. Repeat steps 3–5 per instance.

## Updating in place

After `git pull`, re-run `./deploy/deploy.sh --instance myalpha`. D1/R2 are reused, pending migrations
applied, both Workers redeployed; tokens/clients/builds/logs are preserved. **Your email and Access
settings are remembered** — a bare re-run keeps them (pass the flags again only to change them). A
daily cron checks for a newer Alpha Gate release (comparing against `release.json` in this checkout's
git origin) and shows a dashboard banner + a "last checked" line on Settings when one exists.

## Backup & recovery

The irreplaceable state lives in **D1** (clients + their tokens, builds, channels, logs, the audit
chain). R2 holds only archive bytes, which you can re-create by re-publishing. So a backup is a D1 dump:

```bash
./deploy/backup.sh --instance myalpha            # → .deploy/myalpha-<timestamp>.sql
./deploy/backup.sh --instance myalpha --out ~/secure-backups
```

Run it before a risky change, or on a schedule (cron/launchd). The dump contains **live tokens** — keep
it off the laptop (private storage) and prune old copies.

**Restore** (into a freshly deployed instance, e.g. after losing the laptop or moving accounts):

```bash
./deploy/deploy.sh --instance myalpha            # provision + deploy a clean instance first
npx wrangler d1 execute alpha-gate-myalpha --remote --file myalpha-<timestamp>.sql   # load the dump
```

**What deploy state you can lose safely.** Re-running `deploy.sh` regenerates the entire `.deploy/`
directory (configs, resolved ids, URLs, remembered email/Access inputs are re-derived from live
resources or re-prompted) — so losing `.deploy/` costs nothing but a re-run. The one thing NOT in D1
or `.deploy/`: your **Sparkle private key** (in your login Keychain) and the **Access service token**
(also Keychain). Export the Sparkle key now and store it off-machine — see the warning in
[UPLOADING §1a](UPLOADING.md#1-wire-sparkle-into-your-app-once). The service token can be recreated in
Cloudflare Zero Trust and re-entered with `./publish.sh … --reset-token`.

## Teardown

```bash
./deploy/teardown.sh --instance myalpha              # archives D1, prompts, then destroys
./deploy/teardown.sh --instance myalpha --no-archive # skip the backup
./deploy/teardown.sh --instance myalpha --dry-run    # rehearse
```

After confirmation (type the instance name, or `--yes`) it **archives the database first** to
`.deploy/<slug>-<timestamp>.sql` (that dump contains **live tokens** — store it securely or delete it),
then deletes both Workers and D1 and the local configs. Two things it can't do with pure wrangler,
printed as a closing checklist: **empty/delete the R2 bucket** (do it in the dashboard) and **remove the
Cloudflare Access application** for `<slug>-admin`.

## Troubleshooting

- **Admin returns 403 after working before** — usually the Access secrets are stale. If you renamed your
  Zero Trust team, the team domain changed (`<new>.cloudflareaccess.com`); re-run deploy with the new
  `--access-team-domain` (the AUD usually stays). Deleting/recreating the Access app changes the AUD —
  re-run with the new `--access-aud`.
- **Publishing gets an HTTP 302 / "Access rejected"** — the service token isn't admitted: add the
  **Service Auth** policy (step 5), confirm the token credentials, and ensure the token is in the same
  account as the app.
- **`deploy.sh` stops at preflight** — it tells you what's missing and how to fix it (Node ≥ 20; run
  `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` for CI).
