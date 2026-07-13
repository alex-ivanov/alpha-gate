# Teardown

How to remove an Alpha Gate instance completely — both Workers, the database, the local state, and the two steps you finish by hand.

## The command

```bash
./deploy/teardown.sh --instance <slug>               # confirm, archive the database, destroy
./deploy/teardown.sh --instance <slug> --dry-run     # rehearse: print the plan, touch nothing
./deploy/teardown.sh --instance <slug> --no-archive  # destroy without the database backup
./deploy/teardown.sh --instance <slug> --yes         # skip the confirmation prompt (CI)
```

From npm the same flags apply: `npx alpha-gate teardown --instance <slug>`. `--archive-dir <dir>` writes the database archive somewhere other than the state directory.

You need wrangler authentication (`npx wrangler login`, once per machine). The command prints the full destructive plan before touching anything, then asks you to **type the instance name** to confirm. Any other input aborts with nothing deleted. A non-interactive run without `--yes` refuses instead of hanging.

## What it does

The steps run in this order:

1. Archives the database first, while it still exists, to `<state-dir>/<slug>-<timestamp>.sql`. The state directory is `.deploy/` in a git clone, `~/.alpha-gate` for the npm install. This is the same dump [backup](backup.md) produces and **it contains your testers' live access tokens** — move it to private storage or shred it. If the export fails, teardown stops and nothing is destroyed; fix the error, or re-run with `--no-archive` to destroy without a backup.
2. Deletes the app Worker (`alpha-gate-<slug>`) and the admin Worker (`alpha-gate-<slug>-admin`). Workers that are already gone are tolerated, so re-running after a partial teardown works — pass `--no-archive` on the re-run if the database was already deleted, since the archive step has nothing left to export.
3. Deletes the R2 bucket, but only if it is already empty. A non-empty bucket is left in place and reported.
4. Deletes the D1 database.
5. Removes the local configs from the state directory: `<slug>.app.toml`, `<slug>.admin.toml`, `<slug>.state.json`.

A `--dry-run` prints the same plan and step lines but runs no wrangler commands and deletes no files.

## What stays manual

Two things pure wrangler cannot do, printed as the closing checklist:

- Empty and delete a non-empty R2 bucket: dashboard → R2 → the bucket → delete. This line appears only when the bucket survived; an empty bucket was already deleted for you.
- **Remove the Cloudflare Access application** for `alpha-gate-<slug>-admin`: Zero Trust → Access → Applications. Until you do, a dead application lingers in your Zero Trust account.

Teardown also does not touch the Access service token. publish.sh had you create one the first time you published to this instance (a CI runner may hold another); remove them under Zero Trust → Access → Service Auth., remove it under Zero Trust → Access → Service Auth.

## What survives on your Mac

Teardown never touches the Keychain. Two secrets stay in your login Keychain:

- The **Sparkle private key**. Its public half (`SUPublicEDKey`) is baked into every build you shipped, and if the key is lost, **every already-installed app rejects all updates** — even from a fresh instance later. Keep it unless you are retiring the app for good. See [Sparkle integration](../integrate/sparkle-swift.md).
- The Access service token that `publish.sh` stored, keyed by instance. It is a credential for the Access application you are deleting, so it becomes useless once that application is gone; a future instance takes a new one via `./publish.sh <file> --reset-token`.

Delete them from your login Keychain by hand if you want them gone: the service token is two items under the service `alpha-gate-access` (`<slug>-client-id` and `<slug>-client-secret`); the Sparkle key is the item `generate_keys` created (search for "sparkle").
