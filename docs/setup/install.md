# Install

How to install the Alpha Gate CLI, from npm or from a git clone, and run both Workers on your machine without a Cloudflare account.

## Requirements

- **Node ≥ 20** and npm.
- A Cloudflare account — only when you deploy (the free tier is enough). Local development and tests need no account.
- macOS — only when you [publish builds](../operate/publish.md); Apple signing and notarization run on your Mac. Deploying works from any OS.

## Install from npm

No clone; you run a pinned, versioned release:

```bash
npx alpha-gate deploy --instance <slug>
```

`npx alpha-gate <command>` runs the latest published version; `npx alpha-gate@0.1.0 <command>` pins one. You can also install globally with `npm i -g alpha-gate` and run `alpha-gate <command>`. The commands are `deploy`, `dev`, `publish`, `backup`, and `teardown`; run `alpha-gate <command> --help` for a command's options.

State — per-instance records (`<slug>.state.json`) and the rendered wrangler configs — lives in `~/.alpha-gate`. Set `$ALPHA_GATE_HOME` to move it. The package files themselves sit in npm's versioned cache, so nothing durable is written there.

## Install from a clone

For contributors, or to run unreleased `main`:

```bash
git clone <your-fork> alpha-gate
cd alpha-gate
npm install
```

The `deploy/*.sh` wrappers are the same CLI: `./deploy/deploy.sh --instance <slug>` takes the same flags as `npx alpha-gate deploy --instance <slug>`. A clone keeps its state in the repo's `.deploy/` directory instead of `~/.alpha-gate`, so a checkout keeps finding the instances it deployed. `npm install` needs no Cloudflare account, and the test suite (`npm test`) runs offline.

## Run it locally

```bash
./deploy/dev.sh
```

This starts both Workers on Miniflare with no Cloudflare account: the app on `http://localhost:8787` and the admin on `http://localhost:8788/admin`. It renders a local wrangler config, applies migrations to a local database, seeds a demo user and a demo build so `/get`, `/appcast`, and `/download` return real data, and prints the seeded `/get?token=` link. The first run downloads the `workerd` runtime, so it needs the network once. Ctrl-C stops both Workers.

Flags:

| Flag | Effect |
|---|---|
| `--port <n>` | App port (default 8787); the admin runs on the next port up. |
| `--no-seed` | Skip the demo user and build. |
| `--reset` | Wipe the local D1/R2 state before starting. |
| `--role app` or `--role admin` | Start one Worker instead of both. |

The local admin runs behind a dev-only auth shim: there is no login, every request acts as the admin `dev@local`, and mutations are audited under that name. **The shim is localhost-only and cannot ship** — nothing in the deployed Worker references it, and it refuses to serve unless `DEV_ADMIN=1`, which only `dev.sh` sets. Production admin auth is unchanged.

From an npm install, `alpha-gate dev` starts one Worker at a time: the app by default, or the admin with `--role admin`.

## Where state lives

| Install | State directory |
|---|---|
| npm (`npx alpha-gate`) | `~/.alpha-gate` |
| git clone | `<repo>/.deploy` |

`$ALPHA_GATE_HOME` overrides both. The directory holds per-instance deploy records and the rendered wrangler configs; the data itself — users, tokens, builds, channels — lives in your instance's D1 database (see [Backup](../maintain/backup.md)).

Next: [Prepare your Cloudflare account](cloudflare-account.md)
