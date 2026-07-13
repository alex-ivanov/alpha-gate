# Activation

How the per-user token reaches your app, and what to implement on the app side and the admin side.

## Why the token is out-of-band

The build is generic and signed once. **The token is never embedded in the binary** — embedding it would break the notarization seal and force a signing pass per user. Instead, every user installs the same artifact, and the token, the user's only credential, reaches the app at runtime through a deep link or a paste. The token never sits in Sparkle's static configuration either: `SUFeedURL` stays unset, and your app holds the token and builds the per-user feed URL from it at check time (see [Sparkle in Swift](sparkle-swift.md)). (see [Sparkle in Swift](sparkle-swift.md)).

## What the token is

A token is 32 characters of Crockford base32 (digits and letters, excluding I, L, O, U), carrying 160 bits of entropy. One token exists per user, and it gates the download, the appcast, and the `/get` page alike. Lookup is forgiving: case, whitespace, hyphens, and the confusable characters O (read as 0) and I/L (read as 1) are normalized, so a hand-typed paste still matches.

The token travels in URLs (`/get?token=`, `/appcast?token=`, `/download?token=`), which means it appears in Cloudflare's own request logs. That is an accepted trade-off for a private alpha. Two mitigations apply: an unknown token is indistinguishable from a revoked one (the same generic 404 on `/get` and `/download`, the same renewal notice on `/appcast`), so a response never confirms that a token exists, and the `/get` page sets `Referrer-Policy: no-referrer`, so the token never leaks through a Referer header.

## The activate URL scheme

The user's `/get` page shows two buttons, Download and Activate. Activate links to `<scheme>://activate?token=<token>`. The scheme comes from the **Activate URL scheme** field in admin Settings and must equal the scheme your app registers in its `Info.plist` under `CFBundleURLTypes → CFBundleURLSchemes`. If the two differ, clicking Activate opens nothing on the user's machine, because macOS finds no handler for the URL.

## App side

First launch has no token, so show an activate prompt with two ways in:

- **Deep link.** Handle `<scheme>://activate?token=<token>`: store the token in the Keychain, then start the updater.
- **Paste.** The `/get` page prints the raw key under the buttons ("Access key — paste it in the app if Activate doesn't open it"), so keep a text field that accepts it. You do not need to clean the input; the server normalizes case, whitespace, hyphens, and the O/I/L confusables.

An illustrative handler (AppKit; lives in your app):

```swift
func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls where url.host == "activate" {
        guard let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "token" })?.value
        else { continue }
        Keychain.token = token   // your Keychain wrapper
        startUpdateChecks()      // safe now: a feed URL exists
    }
}
```

Do not start update checks before a token exists; with no feed URL, Sparkle errors. The delegate that turns the stored token into the per-user feed URL is covered in [Sparkle in Swift](sparkle-swift.md) and [Sparkle in a Go app](sparkle-go.md).

## Lifecycle: revoke, reactivate, reissue

Revoking a user cuts access at once: `/download` returns 404, and the next update check receives an informational renewal notice instead of a build. The notice is a Sparkle item with no enclosure, so it can never be installed. It shows the title and message configured in Settings, displays as version "Access renewal", and links to the public `/access` page where the user can request access again. An active user is never shown this notice.

Because the token was never in the binary, the installed app recovers **without a reinstall**:

- **Reactivate** restores access on the existing link and token; updates resume on the app's next check.
- **Reissue** replaces the link and invalidates the token the installed app holds. The old link stops working; the user opens the new `/get` link and activates again, by deep link or paste. The old link stops working; the user opens the new `/get` link and activates again, by deep link or paste.

## Admin side: where the scheme is set

- **Guided first deploy.** On a fresh database, `./deploy/deploy.sh` prompts for the Activate URL scheme (default `myapp`), along with the app name, blurb, and accent colour.
- **Settings.** The admin Settings page has the *Activate URL scheme* field under *App activation*, next to the Sparkle public key. The `/get` page reads the scheme on every request, so a correction applies to every existing invite link immediately.

Next: [Add users](../operate/add-users.md)
