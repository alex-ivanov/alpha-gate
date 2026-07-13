# Publish builds

Ship a build with one command, from the browser, or from CI, and roll back a bad release.

## The one command

```bash
./publish.sh MyApp.dmg --channel beta              # from a clone
npx alpha-gate publish MyApp.dmg --channel beta    # from npm, same flags
```

The artifact is a `.dmg` or a signed `.app` `.zip`. Before you run it:

- The artifact is already built, code-signed with Developer ID, notarized, and stapled. `publish.sh` does not build or notarize.
- The app inside has an integer `CFBundleVersion` that increases every release. The server rejects non-integers; override a bad value with `--build-number <n>`.
- Sparkle's `sign_update` is findable. The script auto-discovers it under Xcode's DerivedData; otherwise pass `--sign-update <path>`.

What it does, in order:

1. Reads `CFBundleShortVersionString`, `CFBundleVersion`, and `LSMinimumSystemVersion` from the app inside the artifact (mounting a DMG, or reading the plist out of a zip) and prints what it read.
2. Pre-checks the build number and channel against the running instance, so a duplicate build number or a mistyped channel name fails in a second instead of after a multi-minute upload.
3. Signs the artifact with `sign_update` to produce the Sparkle EdDSA signature.
4. Uploads. Over 90 MB it switches to the register path on its own: it puts the bytes into R2 with your own `wrangler` auth, then registers the metadata. No extra token.

When exactly one instance is deployed, the script targets it automatically; otherwise pass `--instance <slug>` or `--admin-url <url>`. Channels are named on the command line (`--channel beta`, never a database id); the channel must already exist (see [Channels](channels.md)). **One signed DMG serves both first-install and updates** — the `/get` download and the Sparkle enclosure are the same artifact, signed once.

## The service token, the first time

The admin Worker sits behind Cloudflare Access, so `publish.sh` authenticates with an Access service token. On the first publish to a real instance the script prints the steps and prompts for the credentials:

1. Cloudflare Zero Trust → Access → Service Auth → "Create service token".
2. On the admin Access application, add a policy (Action: Service Auth) allowing it.

It stores the Client ID and Secret in your login Keychain, keyed by instance; every later run reads them without prompting. Pass `--reset-token` to forget the stored pair and enter a new one. Publishing to a `localhost` dev admin needs no token.

## Useful flags

| Flag | What it does |
|---|---|
| `--channel <name>` | link the build to a channel by name |
| `--instance <slug>` | pick the instance when more than one is deployed |
| `--admin-url <url>` | target an admin Worker directly (CI, or no local deploy state) |
| `--sign-update <path>` | where `sign_update` lives (or set `$SIGN_UPDATE`); set `ED_SIGNATURE=<sig>` to skip signing entirely |
| `--build-number <n>` | override the `CFBundleVersion` read from the app |
| `--short-version <s>` | override the `CFBundleShortVersionString` read from the app |
| `--min-os <version>` | override the `LSMinimumSystemVersion` read from the app |
| `--critical` | mark the build as a critical update |
| `--reset-token` | forget the stored service token and prompt again |
| `--dry-run` | read and validate the artifact, print what would be published, upload nothing |

## Browser upload

The admin Upload page publishes without the script. Picking an archive autofills the version, build number, and minimum macOS from the app's `Info.plist`; the fields stay editable. **Autofill works only for a signed `.app` `.zip`** — a `.dmg` or `.tar` can't be read in the browser, so type those fields yourself.

The page has two modes: New release and Roll back. Roll back shows the current highest build number and enforces it as a floor: a build number at or below it is rejected.

## CI

The same script runs headless on a macOS runner. Put the service token in the environment and pass `--admin-url`:

```bash
export CF_ACCESS_CLIENT_ID=<client-id>
export CF_ACCESS_CLIENT_SECRET=<client-secret>
./publish.sh dist/MyApp.dmg \
  --admin-url https://alpha-gate-<slug>-admin.<account>.workers.dev --channel beta
```

A runner without a readable app bundle (a bare zip) passes `--build-number` and `--short-version` and sets `ED_SIGNATURE` from its own `sign_update` step. `.github/workflows/publish.yml` in the repository is a ready sample.

## Rollback

Sparkle cannot downgrade: an update below the installed version is never offered, so you cannot re-serve the old build as-is. Withdrawing a bad version is a roll-forward:

1. Rebuild the previous good code with a **higher** `build_number` (keep the old `short_version`). Publish it into the affected channel — the Upload page's Roll back mode shows the current highest build as the floor and rejects anything at or below it.
2. Open the bad build from the Builds list and withdraw it; the Withdraw action is in the danger zone on the build's page. Because the higher build exists, no one is stranded — installed apps move to the roll-forward build on their next check, and the serving map on the Overview page shows the switch immediately.

## Verify end to end

1. The build appears on the admin Builds page, with download and update counts.
2. Invite yourself (see [Add users](add-users.md)), open your `/get?token=` link, install, activate, and let the app check for updates.
3. The Activity log shows a `check` carrying your installed build, then a `download` or `update`. Activity older than 90 days is pruned, so the counts on builds cover the last 90 days, not all time.
4. Ask the feed directly:

   ```bash
   curl "https://<app-host>/appcast?token=<TOKEN>&installed=1"
   ```

   The response should list an `<item>` for your build.

Next: [Monitoring](monitoring.md)
