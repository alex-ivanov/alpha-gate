# Migrate an instance to a different Cloudflare account

How to move a running instance to another Cloudflare account without stranding the apps your users already installed.

## Why this is more than backup and restore

The Workers run on `*.workers.dev`, and that hostname embeds the account: the app Worker serves at `https://alpha-gate-<instance>.<account>.workers.dev`. A new account means a new `<account>` label, so the app hostname changes. Every installed app has the old host baked into the feed URL its code builds (see [Sparkle integration](../integrate/sparkle-swift.md)) — it checks the old host and knows nothing about the new one.

The database restores cleanly ([backup](backup.md) covers the dump), but restoring alone does not move your users. Until each app installs a build whose feed URL points at the new host, it depends on the old instance. Tear down the old instance before that update has landed and **installed apps stop updating**; the only recovery is asking every user to reinstall by hand. So treat the move as a planned cutover, not a restore.

## The order that works

Nothing below interrupts the old instance until the last step. Users keep updating throughout. (The `npx alpha-gate <cmd>` form takes the same flags as the `./deploy/*.sh` wrappers shown here.)

1. **Keep the old instance running** and take a fresh dump:

   ```bash
   ./deploy/backup.sh --instance <slug>     # → .deploy/<slug>-<timestamp>.sql
   ```

   The dump contains your testers' live access tokens — handle it like a secret.

2. **Log wrangler into the new account, create the database there, and restore into it while it
   is still empty** (importing after a deploy fails on migration conflicts — see
   [backup](backup.md)):

   ```bash
   npx wrangler login                        # the NEW account
   npx wrangler d1 create alpha-gate-<slug>
   npx wrangler d1 execute alpha-gate-<slug> --remote --file .deploy/<slug>-<timestamp>.sql
   ```

   The same slug is fine: a different account means a different `<account>` label, so the
   hostnames cannot collide. Users, tokens, channels, build metadata, logs, and the audit chain
   all carry over. Archive bytes do not — R2 is not in the dump, so the restored build rows have
   nothing downloadable behind them yet. Step 7 fixes that.

3. **Deploy on top of the restored database:**

   ```bash
   ./deploy/deploy.sh --instance <slug>
   ```

   The deploy finds the database, sees its migrations already recorded, and skips the first-init
   prompts — your app name, activate scheme, and branding came back with the dump.

4. **Redo the two manual Access steps** for the new account: enable Cloudflare Access on the new admin hostname and allowlist your email, exactly as in [deploy](../setup/deploy.md). Both values change, because Zero Trust teams are per account. Feed them back:

   ```bash
   ./deploy/deploy.sh --instance <slug> \
     --access-team-domain <team>.cloudflareaccess.com --access-aud <AUD>
   ```

5. **Create a service token in the new account's Zero Trust** (with a Service Auth policy on the new admin Access application, as in [publish](../operate/publish.md)). Your Keychain still holds the old account's token under this slug, so on the first publish to the new instance pass `--reset-token`; `publish.sh` prompts for the new Client ID and Secret and stores them.

6. **Check email carried over, if you used it.** The flags ride in the slug's local state, so the step-3 deploy reuses them and prints `(reusing email: …)`. If that line is missing (a different machine, a lost state directory), pass the flags once — this can ride on the same run as step 4:

   ```bash
   ./deploy/deploy.sh --instance <slug> --email-provider cloudflare --email-from alpha@<sending-domain>
   ```

7. Ship the cutover release. Rebuild your app so its feed URL points at the new app host (`https://alpha-gate-<slug>.<new-account>.workers.dev`), give it a higher `CFBundleVersion`, and publish the artifact to both instances:

   ```bash
   # to the OLD instance — installed apps still check there
   ./publish.sh MyApp.dmg --channel <name> \
     --admin-url https://alpha-gate-<slug>-admin.<old-account>.workers.dev

   # to the NEW instance — gives the restored data a downloadable top build
   ./publish.sh MyApp.dmg --channel <name> --instance <slug> --reset-token
   ```

   Local state for the slug now points at the new account, so the old instance must be addressed with `--admin-url`; that publish prompts for the old account's service token, which still exists in the old Zero Trust. Every app that installs this build starts checking the new host, where its restored token is already valid.

8. **Watch the new instance's Activity page** until your users appear there. Each updated app's next check shows up as a `check` entry carrying its installed build (see [monitoring](../operate/monitoring.md)). Users who have not updated yet are still on the old instance — leave it running until the checks you care about have moved.

9. **Tear down the old instance.** Teardown acts on whichever account wrangler is logged into, and you are currently logged into the new one — log back into the old account first:

   ```bash
   npx wrangler login                         # the OLD account
   ./deploy/teardown.sh --instance <slug> --dry-run   # confirm it targets the old resources
   ./deploy/teardown.sh --instance <slug>
   ```

   It archives the old D1 first — one more backup. [Teardown](teardown.md) covers the closing checklist (empty the R2 bucket, remove the old Access application). Teardown also removes the slug's local state files, which by now describe the NEW instance — take a copy of the state directory first, and log wrangler back into the new account when you are done.

## Next time: a custom domain on the app Worker

Both Workers serve on whatever hostname the request arrives on; the one `workers.dev` assumption is the invite-link derivation (`src/lib/hosts.ts`), so `/get` links keep using the `workers.dev` app host even after you attach a domain. If you attach a domain you control to the app Worker (a Cloudflare dashboard action; the account needs a zone for that domain) and bake that hostname into your app's feed URL from day one, the host in installed apps never changes. A future account move is then deploy, restore, redo Access, and re-point the domain at the new account's Worker — steps 7 and 8 disappear. Do it before the first build ships with a `workers.dev` feed URL.

## Invite links

Every `/get?token=` link you already sent embeds the old host, so those links die with the old instance. The tokens themselves survive the restore unchanged: activated apps are unaffected, because the token rides in the feed URL the app builds, not in the link. Only users who have not yet redeemed an invite need a fresh link — open each user's page on the new admin, which shows the current `/get?token=` link, and re-send it (see [add users](../operate/add-users.md)). The links the admin shows are derived from the `workers.dev` naming contract (`src/lib/hosts.ts`), so they point at the new host as soon as the new admin is up.

Next: [Teardown](teardown.md)
