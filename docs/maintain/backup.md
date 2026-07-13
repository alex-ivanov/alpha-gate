# Backup and restore

This page covers what to back up, how the backup command works, and how to restore a dump into a fresh instance.

## What matters

The irreplaceable state lives in D1: users and their tokens, build metadata, channels, logs, and the audit chain. R2 holds the archive bytes, which you re-create by publishing the same artifacts again, the branding images, which you re-upload on the Settings page, and the daily audit-chain anchors, which are append-only tamper evidence that a fresh instance starts over. So a backup is a D1 dump; everything else in R2 is either re-creatable or restarts clean.

Two things live only in your login Keychain, in neither D1 nor the local deploy state:

- The Sparkle private key. **Export it now** — run `generate_keys -x sparkle_private.pem` from Sparkle 2's `bin/` directory and store the file off the laptop, in a password manager or an encrypted backup. If you lose the key, every already-installed app rejects all future updates: Sparkle verifies each download against the public key baked into the app, and no matching signature can be produced without the private key. No dump restores this.
- The Access service token, which `publish.sh` stores on first use. This one is recreatable: make a new one in Cloudflare Zero Trust (Access → Service Auth), include it in the Service Auth policy on the admin Access application, and re-enter it by passing `--reset-token` on your next publish.

## The backup command

```bash
./deploy/backup.sh --instance <slug>          # from a clone
npx alpha-gate backup --instance <slug>       # from npm
```

Both forms export the remote D1 database to `<slug>-<timestamp>.sql` in the state directory — `.deploy/` in a clone, `~/.alpha-gate` from npm. Pass `--out <dir>` to write somewhere else:

```bash
./deploy/backup.sh --instance <slug> --out ~/secure-backups
```

Run it before a risky change, or on a schedule with cron or launchd. The dump path is the last line the command prints on stdout, so a scheduled job can capture it with `tail -n 1`. This is the same export `teardown.sh` takes before destroying an instance.

**The dump contains your testers' live access tokens.** Anyone who reads it can download your builds as any tester. Keep it off the laptop, in private storage, and prune old copies.

## Restore

Restore in this order: create the empty database, import the dump into it, then deploy. Importing
into an already-deployed instance fails — the deploy has applied migrations, and the dump replays
`d1_migrations` and every table, so the import hits conflicts and rolls back.

```bash
npx wrangler d1 create alpha-gate-<slug>                                    # the empty database
npx wrangler d1 execute alpha-gate-<slug> --remote --file <slug>-<timestamp>.sql
./deploy/deploy.sh --instance <slug>                                        # deploy on top
```

The deploy finds the restored database, sees its migrations already recorded, and skips first-init
prompts because your settings came back with the dump. Keep the `--remote` flag on the import:
without it, wrangler applies the dump to a local development copy and the deployed instance is
unchanged. Users keep their existing tokens and `/get` links after the restore while the hostname stays the same. Restoring under a different instance slug or account changes the hostname, which breaks every link you already sent and every installed app's feed URL — that move is a planned cutover, not a restore (see [Migrate to another account](migrate-account.md)).

## Losing the local state directory

The state directory (`.deploy/` or `~/.alpha-gate`, overridden by `$ALPHA_GATE_HOME`) is not a backup target. Re-running `deploy.sh` regenerates it: configs, resolved ids, URLs, and the Access wiring are re-derived from the live resources. The one exception is email — **those flags are remembered only in the state directory**, so after losing it pass `--email-provider` and `--email-from` once more. A bare re-run without them quietly reverts invites to copy-paste links.

Next: [Migrate to another account](migrate-account.md)
