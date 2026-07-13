# Updating Alpha Gate

How to keep the tool itself up to date on your deployed instances.

## How you learn about a release

The deployed admin Worker runs a daily cron (12:00 UTC) that polls the npm registry for this
package's latest version (`registry.npmjs.org/<name>/latest`) and compares it against its baked-in
`TOOL_VERSION` — the version of the package that deployed it. When a newer version exists:

- the admin dashboard shows an attention item: *Alpha Gate \<version> is available*, with a
  release notes link;
- the Settings page's **Self-update** row shows a `<version> available` tag; when the instance is
  current it reads *up to date* with a last-checked time instead. A fresh deploy shows
  *not checked yet* until the cron first fires, within 24 hours.

If email is configured, the instance also sends one notice per new version to the `--email-from` address; route that mailbox to yourself to receive it.

**The Worker only notifies — it never deploys itself.** Self-deployment would require a privileged
Cloudflare API token on the edge, which the design forbids. Updating is always an operator-run
`deploy`, so migrations happen with a human in the loop.

## Update from npm

```bash
npx alpha-gate@latest deploy --instance <slug>
```

`@latest` fetches the newest published version; the rest is an ordinary re-deploy. To pin a
specific version, name it: `npx alpha-gate@0.1.0 deploy --instance <slug>`.

## Update from a clone

```bash
git pull
./deploy/deploy.sh --instance <slug>
```

Re-running `deploy.sh` updates the instance in place. The clone runs whatever `main` you pulled,
which may be ahead of the npm release.

## What a re-deploy preserves

A re-deploy is idempotent. It reuses the existing D1 database and R2 bucket, applies any pending
migrations, and redeploys both Workers. Preserved across updates:

- all data: users and their tokens, builds, channels, logs, the audit chain;
- your email settings and Access secrets — they are remembered in the deploy state directory of the channel you deployed with (`.deploy/` in a clone, `~/.alpha-gate` for npm), so a bare re-run through that same channel keeps them. An update through the other channel finds no remembered flags and quietly reverts invites to copy-paste; pass `--email-provider`/`--email-from` (or `--access-team-domain`/`--access-aud`) again when you switch channels or want to change them. Pass
  `--email-provider`/`--email-from` or `--access-team-domain`/`--access-aud` again only to change
  them.

Nothing about a routine update requires a backup, but taking one first is cheap — see
[Backup](backup.md).

## Breaking releases

When an upgrade needs manual steps, the release is marked breaking. The dashboard banner adds
*Includes breaking changes.* and the Settings tag reads `<version> available (breaking)`.

**When the banner says breaking, read the release notes before you run deploy.** The banner's
*Release notes* link points at the changelog; it lists the manual steps. Take a
[backup](backup.md) before a breaking update.

## Forks

A fork should not track upstream's npm package. Point the update check at your own manifest by
setting `UPDATE_MANIFEST_URL` when you deploy — the URL is baked into the Worker at deploy time and
is read from the environment on every deploy run, so set it each time (or export it in your shell):

```bash
UPDATE_MANIFEST_URL=https://registry.npmjs.org/<your-package>/latest \
  ./deploy/deploy.sh --instance <slug>
```

The URL can be your own package's `/latest` endpoint, or any static JSON in the shape of the
repo's `release.json`:

```json
{
  "latest": "0.1.0",
  "min_supported": "0.1.0",
  "notes_url": "https://<your-host>/CHANGELOG.md",
  "breaking": false
}
```

Keep `latest` in sync with your `package.json` version on every release; set `breaking: true` when
an upgrade needs manual steps. Until the manifest URL resolves, the check fails quietly and the
banner stays silent. Settings still shows a last-checked time — the timestamp records that the
check ran, not that it found anything.

Next: [Teardown](teardown.md)
