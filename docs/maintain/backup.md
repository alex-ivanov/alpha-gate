# Backup and restore

This page covers what to back up, how the backup command works, and how to restore a dump into a fresh instance.

## What matters

The irreplaceable state lives in D1: users and their tokens, build metadata, channels, logs, and the audit chain. R2 holds only archive bytes, and you can re-create those by publishing the same artifacts again. So a backup is a D1 dump — nothing else on the server side needs saving.

Two things live only in your login Keychain, in neither D1 nor the local deploy state:

- The Sparkle private key. **Export it now** — run `./bin/generate_keys -x sparkle_private.pem` (Sparkle 2's bundled tool) and store the file off the laptop, in a password manager or an encrypted backup. If you lose the key, every already-installed app rejects all future updates: Sparkle verifies each download against the public key baked into the app, and no matching signature can be produced without the private key. No dump restores this.
- The Access service token, which `publish.sh` stores on first use. This one is recreatable: make a new one in Cloudflare Zero Trust (Access → Service Auth) and re-enter it by passing `--reset-token` on your next publish.

## The backup command

```bash
./deploy/backup.sh --instance <slug>          # from a clone
npx alpha-gate backup --instance <slug>       # from npm
```

Both forms export the remote D1 database to `<slug>-<timestamp>.sql` in the state directory — `.deploy/` in a clone, `~/.alpha-gate` from npm. Pass `--out <dir>` to write somewhere else:

```bash
./deploy/backup.sh --instance <slug> --out ~/secure-backups
```

Run it before a risky change, or on a schedule with cron or launchd. The command prints the dump path on stdout, so a scheduled job can capture it. This is the same export `teardown.sh` takes before destroying an instance.

**The dump contains live tokens.** Anyone who reads it can download your builds as any user. Keep it off the laptop, in private storage, and prune old copies.

## Restore

Restore into a freshly deployed instance — after losing the laptop, or when moving to another Cloudflare account:

```bash
./deploy/deploy.sh --instance <slug>       # provision + deploy a clean instance first
npx wrangler d1 execute alpha-gate-<slug> --remote --file <slug>-<timestamp>.sql
```

The database name is `alpha-gate-<slug>`. Keep the `--remote` flag: without it, wrangler applies the dump to a local development copy and the deployed instance is unchanged. Users keep their existing tokens and `/get` links after the restore; only the hostname changes if you restored under a different instance slug or account.

## Losing the local state directory

The state directory (`.deploy/` or `~/.alpha-gate`, overridden by `$ALPHA_GATE_HOME`) is not a backup target. Re-running `deploy.sh` regenerates it: configs, resolved ids, URLs, and the Access wiring are re-derived from the live resources. The one exception is email — **those flags are remembered only in the state directory**, so after losing it pass `--email-provider` and `--email-from` once more. A bare re-run without them quietly reverts invites to copy-paste links.

Next: [Migrate to another account](migrate-account.md)
