# Sparkle 2 in a Swift app

How to wire Sparkle 2 into a native macOS app so its updates flow through your Alpha Gate instance.

## What differs from stock Sparkle

One thing: the update feed is per-user. Each user's token selects their channel, pin, and build, so there is no single appcast URL to bake into the app. You leave `SUFeedURL` unset and supply the feed URL at runtime through the updater delegate (below). Everything else (installing the framework, the updater controller, the check-for-updates menu item) is standard Sparkle 2; follow the [official setup guide](https://sparkle-project.org/documentation/) and come back here for the feed.

Keep two hosts straight. The app's feed points at the App Worker: the `app_url` in your deploy state (`.deploy/<slug>.state.json` in a clone, `~/.alpha-gate/<slug>.state.json` from npm). Publishing talks to the admin Worker, a different hostname.

The token is never embedded in the binary — embedding it would break the notarization seal. The build is generic and signed once; the token reaches the app out of band on first launch (see [Activation](activation.md)).

The admin's **App setup** page shows this whole section personalized for your instance, with your activate scheme and saved public key filled in.

## Generate the EdDSA key (once)

Use `generate_keys` from Sparkle 2's `bin/` directory:

```bash
./bin/generate_keys                          # stores the PRIVATE key in your login Keychain; prints the PUBLIC key
./bin/generate_keys -x sparkle_private.pem   # export the private key (for backup, or CI secrets)
./bin/generate_keys --account myapp-alpha    # a second, separately named key alongside the default
```

The private key is what `sign_update` uses at publish time. The Worker never holds it; it only stores the signature string each build produces.

A key generated under `--account <name>`, or kept in an exported file, has to be named at publish time too — `./publish.sh MyApp.dmg --ed-key-account myapp-alpha` or `--ed-key-file`. See [Which signing key](../operate/publish.md#which-signing-key). With no such flag, publishing signs with the default `ed25519` account.

**The private key is unrecoverable — back it up now.** It lives only in your login Keychain. If you lose it (laptop dies, Keychain wiped), every already-installed app rejects all future updates: Sparkle verifies each download against the public key baked into the app, and you cannot produce a matching signature without the private key. Run `./bin/generate_keys -x sparkle_private.pem` and store that file somewhere safe and off the laptop, such as a password manager or an encrypted backup. This is the single most important thing to back up in the whole system.

## Info.plist keys

| Key | Value |
|---|---|
| `SUPublicEDKey` | the public key `generate_keys` printed; Sparkle verifies every download against it |
| `SUFeedURL` | leave unset — the feed is per-user, supplied at runtime |
| `CFBundleURLTypes` → `CFBundleURLSchemes` | your activate scheme, e.g. `myapp`; must equal the *Activate URL scheme* in admin Settings |
| `SURequireSignedFeed` | off / unset — incompatible with per-user feeds (a signed feed would put the signing key on the edge); the per-archive EdDSA still blocks tampering |
| `CFBundleVersion` | a positive integer that increases every release (Sparkle's compare key); see below |
| `CFBundleShortVersionString` | the human version (e.g. `1.4.0`) shown in the update dialog |

**`CFBundleVersion` must be a positive integer that increases every release.** It becomes `build_number` (Sparkle's `sparkle:version`), which Sparkle compares numerically and the server requires to be an integer. `CFBundleShortVersionString` can be anything: `1.4.0`, a git describe. If your build sets `CFBundleVersion` to something non-integer (e.g. `0.0.3` or a hash), publishing rejects it — fix the build, or override per-publish with `--build-number <n>`.

## Supply the feed URL at runtime

Implement the updater delegate so each check carries the token and the installed build:

```swift
func feedURLString(for updater: SPUUpdater) -> String? {
    guard let token = Keychain.token else { return nil }   // no token yet → the check will fail; gate checks on activation (see below)
    return "https://<APP_WORKER_HOST>/appcast?token=\(token)"
}
func feedParameters(for updater: SPUUpdater, sendingSystemProfile: Bool) -> [[String: String]] {
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    return [["key": "installed", "value": build]]          // powers the admin's "current version" + stranded detection
}
```

`<APP_WORKER_HOST>` is the `app_url` host from your deploy state. `Keychain.token` is illustrative — read the token from wherever your activation flow stored it. **Do not start update checks before a token exists**: with no feed, Sparkle errors. The guard does not skip the check — it only keeps a tokenless request from ever reaching the server; hold off enabling automatic checks (or calling checkForUpdates) until activation has stored the token.

## References

- Sparkle basic setup (framework, updater controller): <https://sparkle-project.org/documentation/>
- Keys and signing (`generate_keys`, `sign_update`): <https://sparkle-project.org/documentation/publishing/>

Next: [Activation](activation.md)
