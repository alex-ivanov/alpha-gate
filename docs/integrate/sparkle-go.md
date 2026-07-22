# Sparkle in a Go app

How to wire a Go macOS app to Alpha Gate. There are two routes: a pure-Go client that speaks the
Sparkle wire format ([alex-ivanov/go-sparkle](https://github.com/alex-ivanov/go-sparkle) — no
framework, works in any Go app), and cgo bindings around the real `Sparkle.framework`
([abemedia/go-sparkle](https://github.com/abemedia/go-sparkle), which needs a Cocoa run loop). The
server side is identical either way.

## Route 1: pure Go (alex-ivanov/go-sparkle)

A stdlib-only re-implementation of the Sparkle client: appcast parse, ed25519 verify, download,
and the macOS `.app` swap + relaunch. Signatures and keys are byte-identical with Sparkle's own
tooling, and token-gated feeds are built in — which is exactly what an Alpha Gate feed is.

```bash
go get github.com/alex-ivanov/go-sparkle
```

Configure it with the feed URL template; the `<TOKEN>` and `<CFBundleVersion>` placeholders do
what the Swift page's delegate methods do:

```go
up := sparkle.New(sparkle.Config{
    FeedURL:          "https://<your-app-host>/appcast?token=<TOKEN>&installed=<CFBundleVersion>",
    PublicEDKey:      "<base64 ed25519 public key>", // the same key as SUPublicEDKey
    InstalledVersion: 42,                            // your build number
    OSVersion:        "14.4",                        // filters sparkle:minimumSystemVersion
})

rel, err := up.Check(ctx, token)  // nil when up to date
if rel != nil {
    path, err := up.Download(ctx, rel, token) // length + ed25519 verified before returning
    app, err := sparkle.Apply(path)           // swap the .app in place + relaunch
}
```

The token is percent-encoded into the query (which is where Alpha Gate reads it) and also sent as
an `Authorization: Bearer` header, which Alpha Gate ignores — only the query parameter authenticates. `Apply` handles both `.zip` and `.dmg` artifacts, so whatever
you [publish](../operate/publish.md) installs unchanged.

Differences from framework Sparkle worth knowing with an Alpha Gate feed:

- **Revocation is quiet.** Framework Sparkle shows revoked users the renewal notice
  ([activation](activation.md)); the pure-Go client filters that notice item out (it has no
  enclosure), so `Check` returns nil and a revoked app reads as up to date forever. No error is
  raised and no download is attempted. If you want a visible "renew access" moment, detect it
  yourself: treat the enclosure-less notice item in the fetched appcast as the signal (an active
  token never receives one), or probe `/get?token=` and treat its 404 as revoked.
- **`--critical` has no effect** on this client — critical updates are on its not-implemented
  list, so a critical build installs like any other.

### A pure-Go release pipeline

The library's `cmd/sign_update` is a drop-in replacement for Sparkle's `sign_update` — same flags,
same key format, same output, and on macOS it reads the login Keychain exactly where Sparkle's
`generate_keys` stores the key. `publish.sh` accepts it directly:

```bash
go install github.com/alex-ivanov/go-sparkle/cmd/sign_update@latest
./publish.sh MyApp.zip --channel beta --sign-update "$(command -v sign_update)"
```

You can also mint the keypair without installing Sparkle at all: `sparkle keygen` (from
`cmd/sparkle`) prints the base64 public key to embed and writes the private key file — keys are
interchangeable with Sparkle's. The [backup warning](../maintain/backup.md) applies to that key
file exactly as it does to the Keychain copy. Point publishing at that file with `--ed-key-file
<path>` — see [Which signing key](../operate/publish.md#which-signing-key). The key-selection flags
map onto `sign_update`'s own `--account` / `--ed-key-file`, so they work with either implementation.

## Route 2: framework bindings (abemedia/go-sparkle)

If your Go app already runs a Cocoa UI (webview, Qt, Wails), you can drive the real
`Sparkle.framework` through [abemedia/go-sparkle](https://github.com/abemedia/go-sparkle) —
cgo bindings around Sparkle 2.7.0 via the legacy `SUUpdater` class. You get Sparkle's own UI and
the renewal-notice display, at the cost of shipping the framework:

1. Place `Sparkle.framework` (from the [official releases](https://github.com/sparkle-project/Sparkle/releases))
   in `YourApp.app/Contents/Frameworks/`.
2. Build with `CGO_LDFLAGS='-Wl,-rpath,@loader_path/../Frameworks' go build .`

There is no delegate support, so compose the full feed URL in Go and set it on **every launch**,
before any check — Sparkle persists the URL to user defaults, and re-setting it overwrites a stale
token or build number:

```go
import sparkle "github.com/abemedia/go-sparkle"

sparkle.SetFeedURL("https://<your-app-host>/appcast?token=" + token + "&installed=" + build)
```

## Info.plist and the deep link (both routes)

A Go `.app` bundle's `Info.plist` is yours to author (tools like
[appify](https://github.com/machinebox/appify) scaffold it). The keys match the
[Swift page's table](sparkle-swift.md): an integer `CFBundleVersion`, your activate scheme in
`CFBundleURLSchemes`, no `SUFeedURL`. `SUPublicEDKey` matters to route 2; route 1 takes the key in
its `Config` instead.

macOS delivers `myapp://activate?token=…` as an Apple Event (`kAEGetURL`), not in `os.Args`, so a
Go app needs a small Objective-C shim via cgo: register the handler early
(`applicationWillFinishLaunching`), pass the URL to an `//export`-ed Go function, store the token,
then configure the updater. A worked example of the pattern:
[Handling macOS URL schemes with Go](https://blakewilliams.me/posts/handling-macos-url-schemes-with-go);
Wails v3 ships a [ready-made example](https://pkg.go.dev/github.com/wailsapp/wails/v3/examples/single-instance-url-scheme).
Keep a paste field as the fallback — the `/get` page shows the raw key
(see [activation](activation.md)).

Next: [the token and activation flow](activation.md)
