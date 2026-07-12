# Uploading builds

Everything you need to start shipping builds through Alpha Gate. Prerequisite: a deployed, Access-locked
instance (see [ONBOARDING](ONBOARDING.md)).

The model: you **build, sign, notarize, and EdDSA-sign on macOS**; the Worker only stores the bytes and
the signature and serves them per-user. Do the one-time app wiring once, then publish on each release.

- [1. Wire Sparkle into your app (once)](#1-wire-sparkle-into-your-app-once)
- [2. Create a channel](#2-create-a-channel)
- [3. Invite a user](#3-invite-a-user)
- [4. Publish — one command](#4-publish--one-command)
- [5. Other publish paths (browser, CI)](#5-other-publish-paths-browser-ci)
- [6. Verify end to end](#6-verify-end-to-end)
- [Rollback](#rollback)
- [Getting the invite link to users (email vs copy-paste)](#getting-the-invite-link-to-users)
- [Troubleshooting](#troubleshooting)

## 1. Wire Sparkle into your app (once)

This connects your macOS app to the instance. Two facts to keep straight: your app's Sparkle feed points
at the **App (public)** Worker (`app_url` in `.deploy/<slug>.state.json`), while *publishing* talks to the
**admin** Worker — different hostnames. And **Sparkle never sees the token**: the app holds the per-user
token and builds the feed URL from it; the token is never embedded in the binary (that would break
notarization).

**a. Generate the Sparkle EdDSA key (once)** with Sparkle 2's bundled tool:

```bash
./bin/generate_keys                          # stores the PRIVATE key in your login Keychain; prints the PUBLIC key
./bin/generate_keys -x sparkle_private.pem   # export the private key for CI secrets (keep it safe)
```

The private key is what `sign_update` uses at publish time. **The Worker never holds it** — it only
stores the signature string each build produces.

> **⚠ The Sparkle private key is unrecoverable — back it up now.** It lives only in your login
> Keychain. If you lose it (laptop dies, Keychain wiped), every already-installed app rejects all
> future updates — Sparkle verifies each download against the public key baked into the app, and you
> can't produce a matching signature without the private key. Run `./bin/generate_keys -x
> sparkle_private.pem` and store that file somewhere safe and off the laptop (a password manager, an
> encrypted backup). This is the single most important thing to back up in the whole system.

**b. Info.plist keys** in your app:

| Key | Value |
|---|---|
| `SUPublicEDKey` | the public key `generate_keys` printed — Sparkle verifies every download against it |
| `SUFeedURL` | **leave unset** — the feed is per-user, supplied at runtime |
| `CFBundleURLTypes → CFBundleURLSchemes` | your activate scheme, e.g. `myapp` — **must equal** the *Activate URL scheme* in admin Settings |
| `SURequireSignedFeed` | **off / unset** — incompatible with per-user feeds; per-archive EdDSA still blocks tampering |
| `CFBundleVersion` | a **monotonic integer** (Sparkle's compare key) — see the box below |
| `CFBundleShortVersionString` | the human version (e.g. `1.4.0`) shown in the update dialog |

> **`CFBundleVersion` must be a positive integer that increases every release.** It becomes
> `build_number` / `sparkle:version`, which Sparkle compares numerically and the server requires to be an
> integer. `CFBundleShortVersionString` can be anything (`1.4.0`, a git describe). If your build sets
> `CFBundleVersion` to something non-integer (e.g. `0.0.3` or a hash), publishing will reject it — fix the
> build, or override per-publish with `--build-number <n>`.

**c. Point Sparkle at the per-user feed (runtime)** — implement the updater delegate so each check
carries the token and installed build (illustrative; lives in *your* app):

```swift
func feedURLString(for updater: SPUUpdater) -> String? {
    guard let token = Keychain.token else { return nil }   // no token yet → don't check
    return "https://<APP_WORKER_HOST>/appcast?token=\(token)"
}
func feedParameters(for updater: SPUUpdater, sendingSystemProfile: Bool) -> [[String: String]] {
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    return [["key": "installed", "value": build]]          // powers "current version" + no-downgrade
}
```

`<APP_WORKER_HOST>` is the `app_url` host from your deploy state. Don't start update checks before a token
exists (with no feed, Sparkle errors).

**d. Activation — get the token in.** First launch has no token, so show an "Activate" prompt:
- **Deep link:** handle `myapp://activate?token=XYZ` (your scheme) → store the token in the Keychain.
- **Paste:** a field where the user pastes the key shown on their `/get` page.

A revoked/unknown token later gets an informational "re-activate" notice instead of an update, so the app
self-heals after a reissue — no reinstall.

## 2. Create a channel

Users and builds attach to named channels (`stable`, `beta`, …). Create one on the admin **Channels**
page. **A user with no channel — and a build linked to no channel — receive/serve nothing**, so create at
least one and use it consistently. (The admin surfaces this: a "no channel" warning on users, a hint on
upload.)

## 3. Invite a user

On the admin **Users** page, *Add user* (email, optional label, optional channel). You get the user's
private `/get?token=` link **and the filled invite message**, each with a one-click **Copy** button. The
link stays viewable on the user's page later (viewing never rotates the token). Send it to the user (or it's emailed if
email is configured — see [below](#getting-the-invite-link-to-users)). The link is durable: they revisit
it to re-download or re-activate while the token is active.

## 4. Publish — one command

`publish.sh` ships a **signed, notarized** build (a `.dmg` **or** a signed `.app` `.zip`) in one command.
It reads the version straight from the app, EdDSA-signs the artifact, and uploads it:

```bash
./publish.sh MyApp.dmg --channel beta     # from a clone
npx alpha-gate publish MyApp.dmg --channel beta   # from npm (same flags)
```

**Prerequisites:** the artifact is already **built, code-signed (Developer ID), notarized, and stapled**
(`publish.sh` does not build or notarize), its app has an integer `CFBundleVersion` (see the box in §1b),
and Sparkle's `sign_update` is findable (auto-discovered in Xcode's DerivedData, or pass `--sign-update`).

What it does, in order: reads `CFBundleShortVersionString` / `CFBundleVersion` / `LSMinimumSystemVersion`
from the app inside the artifact (mounting a DMG, or reading the plist out of a zip — prints what it read)
→ **pre-checks the build number and channel against the running instance** (so a duplicate or a typo fails
in a second, not after a multi-minute upload) → finds `sign_update` and signs → uploads, automatically
using the R2 register path for artifacts over ~90 MB (via your own `wrangler` auth — no extra token).

- **Instance is automatic** when only one is deployed; otherwise pass `--instance <slug>` (or `--admin-url`).
- **Channels by name:** `--channel beta` — no DB ids. A single signed DMG serves **both** first-install
  (the `/get` download) and updates; the enclosure is format-agnostic.

**The service token, the first time.** On the first publish to a real instance it tells you how to create a
Cloudflare Access service token (Zero Trust → Service Auth) and prompts for the Client ID + Secret, then
stores them in your **login Keychain** keyed by instance. Every later run reads them automatically. Pass
`--reset-token` to re-enter them. (Publishing to a `localhost` dev admin needs no token.)

**Useful flags:** `--instance <slug>` / `--admin-url <url>`, `--sign-update <path>` (or `$SIGN_UPDATE`, or
`ED_SIGNATURE=<sig>` to skip signing), `--build-number <n>` / `--short-version <s>` (override what's read —
e.g. a non-integer `CFBundleVersion`), `--critical`, `--dry-run`.

## 5. Other publish paths (browser, CI)

- **Browser** — the admin **Upload** page. Picking the archive **autofills** version/build/min-OS from
  the `Info.plist` (editable). It has a **New release** and a **Roll back** mode — roll back shows the
  current highest build number and **enforces** it as a floor (a rollback at or below it is rejected).
  Autofill needs the signed `.app` `.zip`; a `.dmg`/`.tar` can't be read in the browser, so type those.
- **CI (headless)** — the same `publish.sh` on a macOS runner, with `CF_ACCESS_CLIENT_ID` /
  `CF_ACCESS_CLIENT_SECRET` (the service token) in the environment and `--admin-url`:
  ```bash
  export CF_ACCESS_CLIENT_ID=…  CF_ACCESS_CLIENT_SECRET=…
  ./publish.sh dist/MyApp.dmg \
    --admin-url https://alpha-gate-myalpha-admin.<account>.workers.dev --channel beta
  ```
  A runner without a readable app bundle (a bare zip) passes `--build-number`/`--short-version` and sets
  `ED_SIGNATURE` from its own `sign_update` step. `.github/workflows/publish.yml` is a ready sample.

## 6. Verify end to end

1. The build appears on the admin **Builds** page (with download/update counts).
2. Invite yourself (§3), open the `/get?token=` link, install, activate, and let the app check for
   updates.
3. The **Activity** log shows a `check` carrying your installed build, then a `download`/`update`
   (activity older than 90 days is pruned nightly; download/update counts on builds are permanent).
4. Raw check (replace host + token):
   ```bash
   curl "https://<app_url-host>/appcast?token=<TOKEN>&installed=1"   # should list an <item> for your build
   ```

## Rollback

Sparkle can't downgrade, so withdrawing a bad version is a **roll-forward**:

1. Rebuild the previous good code with a **higher** `build_number` (keep the old `short_version`).
   Publish it into the affected channel — the Upload page's **Roll back** mode shows the current highest
   build as the floor and rejects anything at or below it.
2. Open the bad build from the **Builds** list and **Withdraw** it (the action lives in the build
   page's danger zone). Because the higher build is available no one is stranded; clients move to the
   roll-forward build on their next check — the Overview serving map shows the switch immediately.

## Getting the invite link to users

- **Copy-paste (default, no setup):** Add-user shows the `/get?token=` link and your filled invite
  template, each with a Copy button — send them via Slack/iMessage/your own mail. No domain, no provider.
- **Automated email:** needs Cloudflare Email Service (Workers Paid + a real onboarded sending domain;
  `*.workers.dev` can't be it). Configure it via deploy (see [ONBOARDING §7](ONBOARDING.md#7-email-optional)),
  then use **Settings → Send test email** to confirm delivery. A failed send never blocks user creation —
  the page shows the reason and the copy-paste link.

## Troubleshooting

- **"build number … is not a positive integer"** — the DMG's `CFBundleVersion` isn't an integer. Fix the
  build, or pass `--build-number <n>`.
- **Reads the wrong/old version** — the script reads the app *inside the DMG* (it prints which). If that
  app is a symlink, it refuses (it would read your installed copy instead). If the DMG was built from a
  stale app, rebuild it.
- **"Build number N already exists"** — `build_number` is unique and permanent. Publish with a higher
  number (it must increase every release anyway).
- **HTTP 302 / "Access rejected the service token"** — add the **Service Auth** policy on the admin
  Access app (see [ONBOARDING §5](ONBOARDING.md#5-ci-only-create-a-service-token)); re-enter creds with
  `--reset-token` if they're wrong.
- **`hdiutil: Resource busy`** — handled (`publish.sh` mounts the DMG at a random point); if you mounted the
  DMG manually, ejecting it first doesn't hurt.
