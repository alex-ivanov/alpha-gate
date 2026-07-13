# Prepare a Cloudflare account

What to set up on Cloudflare before your first deploy, and what you can skip.

## The free tier is enough

Alpha Gate runs on Workers, D1, and R2, all covered by the free tier. There is **nothing to pre-create**: `deploy.sh` provisions the D1 database and R2 bucket itself. Sign up at cloudflare.com and move on.

## Authenticate wrangler once

The deploy CLI drives your account through wrangler. Grant it access from the machine you deploy from:

```bash
npx wrangler login        # opens a browser; grants this machine access to your account
```

For CI, set `CLOUDFLARE_API_TOKEN` instead of an interactive login.

## Use a dedicated account (recommended)

Whoever can open this account's Cloudflare dashboard can read the D1 database and R2 bucket
directly, and the database rows include every tester's access token — the secret behind their
`/get` link and update feed. **A dashboard user could therefore impersonate any tester.** Testers
themselves never touch the database; the tokens are generated server-side when you add a tester, and
a tester's app only talks to the public Worker. If other people share your Cloudflare account, put
Alpha Gate in its own account so dashboard access does not equal tester access.

## Set up Zero Trust now

After deploy, you lock the admin behind Cloudflare Access, which lives in Cloudflare Zero Trust. The first time you open Zero Trust, Cloudflare makes you pick a **team name** and add a **payment method** before you can create Access applications — even on the free Zero Trust plan. You are not charged on the free plan, You are not charged on the free plan, whose 50-user limit counts only Zero Trust logins such as your admin email, not testers..

Do this once now, at dash.cloudflare.com → Zero Trust, so the Access step after deploy does not stall on account setup.

## What you do not need

- No custom domain and no DNS. Everything runs on `*.workers.dev`.
- No API token for deployment; `wrangler login` covers it (CI is the exception, above).

One caveat for later: sending invite email automatically requires a real sending domain you control — a `*.workers.dev` hostname cannot be one. Copy-paste invite links work without it. See [Email](../operate/email.md).

Next: [Deploy](deploy.md)
