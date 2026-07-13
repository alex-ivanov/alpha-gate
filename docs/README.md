# Alpha Gate documentation

Alpha Gate is a self-hosted distribution gate for notarized macOS apps updated via Sparkle: private,
per-tester download links and update feeds, served from your own Cloudflare account. These pages are
task-oriented; the architecture and its invariants live in [PRINCIPLES](PRINCIPLES.md).

The journey, in order:

## Set up

| Page | Covers |
|---|---|
| [Install](setup/install.md) | The CLI from npm or a clone; running both Workers locally, no account needed |
| [Prepare a Cloudflare account](setup/cloudflare-account.md) | wrangler login, the Zero Trust bootstrap, what you can skip |
| [Deploy](setup/deploy.md) | The first deploy, locking the admin behind Access, verifying, updating in place, multiple instances |

## Integrate your app

| Page | Covers |
|---|---|
| [Sparkle in Swift](integrate/sparkle-swift.md) | The EdDSA key, Info.plist, the runtime per-user feed URL; official Sparkle references |
| [Sparkle in Go](integrate/sparkle-go.md) | Pure-Go via [go-sparkle](https://github.com/alex-ivanov/go-sparkle), or framework bindings — and where they differ |
| [Activation](integrate/activation.md) | The token, the activate deep link, why it is out-of-band, both sides of the wiring |

## Operate

| Page | Covers |
|---|---|
| [Add users](operate/add-users.md) | Inviting, the invite page, access requests, what the user sees |
| [Remove users](operate/remove-users.md) | Revoke, reactivate, reissue, hide — and which one to reach for |
| [Channels](operate/channels.md) | Grouping who gets what: linking builds, assigning users, pinning, the stranding guard |
| [Publish](operate/publish.md) | The one-command publish, the browser upload, CI, rollback, end-to-end verification |
| [Monitoring](operate/monitoring.md) | Reading the Overview, the Next-check column, Activity, and the audit chain |
| [Email](operate/email.md) | Copy-paste invites by default; Cloudflare email as the optional paid add-on |

## Maintain

| Page | Covers |
|---|---|
| [Backup](maintain/backup.md) | What is irreplaceable, the one-command dump, restoring |
| [Migrate to a new account](maintain/migrate-account.md) | The planned cutover a hostname change requires |
| [Updating the tool](maintain/updating.md) | The release banner, updating from npm or a clone, breaking releases |
| [Teardown](maintain/teardown.md) | Removing an instance, and the two steps that stay manual |
| [Troubleshooting](maintain/troubleshooting.md) | Symptoms → causes → fixes, across deploy, publishing, and the feed |

## Reference

- [PRINCIPLES](PRINCIPLES.md) — the architecture, the hard constraints, and the invariants that must
  keep holding. Read it before changing core behavior.
- [CONTRIBUTING](../CONTRIBUTING.md) — the developer guide: conventions, testing, adding a feature.

New here? The shortest useful path is [Install](setup/install.md) →
[Deploy](setup/deploy.md) → [Sparkle in Swift](integrate/sparkle-swift.md) →
[Add users](operate/add-users.md) → [Publish](operate/publish.md).
