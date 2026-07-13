# Troubleshooting

Symptoms, their causes, and their fixes, grouped by area.

## Deploy and access

### The admin returns 403 after it worked before

The Access secrets stored on the Worker are usually stale. The Worker verifies the Access JWT itself and fails closed, so wrong or unset secrets reject every admin request.

- **You renamed your Zero Trust team.** The team domain changed to `<new-team>.cloudflareaccess.com`; the AUD usually stays. Re-run deploy with the new domain:

  ```bash
  ./deploy/deploy.sh --instance <slug> --access-team-domain <new-team>.cloudflareaccess.com
  ```

- **You deleted and recreated the Access application.** The AUD changed. Re-run with the new one:

  ```bash
  ./deploy/deploy.sh --instance <slug> --access-aud <new-aud>
  ```

Where to find both values is covered in [Deploy](../setup/deploy.md).

### `deploy.sh` stops at preflight

Preflight is read-only and prints what failed with a `→` fix line under it. The two common causes: Node is older than 20, or wrangler is not authenticated — run `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` in CI. Fix what the line says and re-run; deploy is idempotent.

### Opening the admin origin redirects to `/admin`

Expected. `GET /` on the admin Worker answers 302 to `/admin`; the back office lives under that path. Nothing to fix.

## Publishing

### "build number … is not a positive integer"

The app's `CFBundleVersion` is not an integer (for example `0.0.3` or a git hash). It becomes `build_number`, which Sparkle compares numerically, so the server requires an integer. Fix the build so `CFBundleVersion` is a monotonic integer, or override for this publish:

```bash
./publish.sh MyApp.dmg --build-number <n>
```

### `publish.sh` reads the wrong or old version

The script reads the app inside the artifact and prints what it read. Two causes:

- The app inside the DMG is a symlink. The script refuses to follow it — it would read your installed copy instead. Build the DMG with a real copy of the app.
- The DMG was built from a stale app. Rebuild the DMG.

### "Build number N already exists"

`build_number` is unique and permanent — it must increase every release anyway. Publish with a higher number.

### HTTP 302, or "Access rejected the service token"

Access redirected the request to its login page instead of admitting the service token. An email one-time-PIN policy alone does not admit service tokens.

- Add a second policy on the admin Access application with action **Service Auth** that includes your token.
- If the stored credentials are wrong, re-enter them with `./publish.sh <artifact> --reset-token`.
- Confirm the token lives in the same Cloudflare account as the Access application.

The service-token setup is covered in [Publish](../operate/publish.md).

### `hdiutil: Resource busy`

Normally handled — `publish.sh` mounts the DMG at a random mount point. If you mounted the DMG manually, eject it first.

## The feed and testers

### A user gets no updates

Check these in order:

- **No channel anywhere.** A user with no channel receives nothing, and a build linked to no channel is served to no one. Attach both to a channel — see [Channels](../operate/channels.md).
- **Pinned below what they run.** Sparkle cannot downgrade — an item below the installed version is never offered. A pin below the installed build takes effect only once a higher-numbered build exists in the channel.
- **Revoked token.** The feed serves an informational "Access renewal" notice instead of an update. Once you reissue and the user re-activates, updates resume without a reinstall.

### `/get` returns 404

An unknown or revoked token gets the same generic 404 as any other miss. **This is by design** — the response reveals nothing about whether a token exists. Compare the token against the link on the user's admin page; a revoked user needs a reissued link.

## Local dev

### Local state is stuck (migrations fail, stale data)

Wipe the local D1/R2 state and start clean:

```bash
./deploy/dev.sh --reset
```

When local migrations fail, the CLI prints this hint itself: retry with `--reset` — a stuck local state can block them.

### "port 8787 is already in use"

An orphaned `workerd` from a prior Ctrl-C'd run usually still holds the port; wrangler does not report the collision itself, so the CLI checks before starting. Free the port or pick another:

```bash
pkill -f workerd
# or
./deploy/dev.sh --port <n>
```
