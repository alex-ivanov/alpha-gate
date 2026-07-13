# Deploy

This page covers the first deploy of an instance, locking the admin behind Cloudflare Access, verifying the result, updating in place, and running more than one instance.

## Run the deploy

Both distribution forms take the same flags:

```bash
npx alpha-gate deploy --instance myalpha        # from npm; state in ~/.alpha-gate
./deploy/deploy.sh --instance myalpha           # from a clone; state in .deploy/
```

The `--instance` slug (lowercase letters, digits, hyphens) namespaces every resource. To rehearse without touching your account, add `--dry-run` — wrangler is mocked and nothing is created.

A run proceeds in four stages: a read-only preflight (Node ≥ 20, wrangler auth; any failure prints a `→` fix line), an inspect pass that reports which resources already exist, a confirm prompt ("Apply these changes?") showing the exact commands, then apply: create the D1 database and R2 bucket, apply migrations, and deploy both Workers. The command is idempotent; re-running updates in place.

The run ends by printing two URLs; until Access is wired it also shows the dashboard checklist covering the Access step below.:

- the app URL (`https://alpha-gate-myalpha.<account>.workers.dev`) — the public host your users and the Sparkle feed use;
- the admin URL (`https://alpha-gate-myalpha-admin.<account>.workers.dev`) — the back office.

### Guided first init

On the first deploy of an instance, any branding value you do not pass as a flag is prompted (interactive runs only; `--yes` and `--dry-run` skip the prompts); press Enter to accept the default; press Enter to accept the default.

- App name (`--app-name`).
- Activate URL scheme (`--activate-scheme`) — **must match a `CFBundleURLSchemes` entry in your macOS app's Info.plist**, because the download page builds the activation deep link from it.
- Short blurb (`--blurb`) and accent colour (`--accent`), both optional branding.

These seed the instance so `/get` is correct immediately. After first init the admin Settings page owns these values; later deploys do not prompt for them.

## Lock the admin behind Cloudflare Access

**The admin URL rejects every request until you complete this step** — the Worker fails closed while the Access secrets are unset. Enabling Access is what makes the admin usable. It is the one manual dashboard action; there is no wrangler command for enabling Access. It is the one manual dashboard action; there is no wrangler command for enabling Access.

The first time you use Zero Trust, Cloudflare makes you pick a team name and, even on the free Zero Trust plan, add a payment method before you can create Access applications. Cloudflare makes you pick a team name and, even on the free Zero Trust plan, add a payment method before you can create Access applications. You are not charged on the free plan, which covers up to 50 seats — only the admin emails you allowlist into Access count against it, never your testers (they authenticate with tokens, not Access).

1. Dashboard → Workers & Pages → the `alpha-gate-myalpha-admin` Worker → Settings → Domains & Routes → enable Cloudflare Access. Cloudflare creates a self-hosted Access application for the admin hostname.
2. Edit that application's policy: action Allow, include Emails → your email, identity method One-time PIN. Cloudflare emails a login code; no external identity provider is needed.
3. Feed two values back to deploy, which sets them as secrets and redeploys for you:
   - Team domain — Zero Trust → Settings, e.g. `yourteam.cloudflareaccess.com` (the bare domain, no `https://`).
   - AUD tag — Access → Applications → your app → Overview → Application Audience (AUD).

```bash
./deploy/deploy.sh --instance myalpha \
  --access-team-domain yourteam.cloudflareaccess.com --access-aud <AUD>
```

An interactive first deploy offers this at the end of the run: it prints the dashboard steps, waits, then probes the admin URL to detect the team domain from the login redirect and prompts for the AUD — no re-run needed.

The Worker verifies the Access JWT itself and fails closed: while these secrets are unset, every admin request is rejected.

## Verify

- Open the admin URL and log in with the one-time PIN. The root path redirects to `/admin`, the Overview page; the serving map shows each channel and what it offers (empty until you publish).
- Open the app URL's `/get` without a token. It returns a generic 404. That is by design — no token, nothing leaked.
- Open Settings. The "This instance" panel shows the Instance slug, the Email status, and your Access team and Access AUD, confirming the secrets landed.

## Update in place

From npm:

```bash
npx alpha-gate@latest deploy --instance myalpha
```

From a clone: `git pull`, then re-run `./deploy/deploy.sh --instance myalpha`.

Either way the existing D1 database and R2 bucket are reused, pending migrations are applied, and both Workers are redeployed. Users, their tokens, builds, channels, and logs are preserved. **Email and Access settings are remembered** — a bare re-run keeps them; pass the flags again only to change them.

A daily cron polls the npm registry for a newer Alpha Gate release. When one exists, the Overview shows a banner ("Alpha Gate <version> is available") and Settings shows it in the Self-update row, along with when the last check ran. A fork can point `$UPDATE_MANIFEST_URL` at its own package or a static `release.json` at deploy time.

## Multiple instances

Re-run with another slug:

```bash
./deploy/deploy.sh --instance staging
```

Every resource is independent per instance: the D1 database, the R2 bucket, both Workers, the Access application, and the local state under `.deploy/<slug>.*` (or `~/.alpha-gate` for the npm form). Repeat the Access step for each instance.

Next: [Sparkle integration (Swift)](../integrate/sparkle-swift.md)
