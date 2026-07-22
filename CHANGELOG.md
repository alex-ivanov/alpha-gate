# Changelog

Notable changes to Alpha Gate (the tool). The deployed instance's daily self-update check polls the
npm registry's `latest` for this package and compares it against its `TOOL_VERSION`; the
dashboard/Settings link here for notes. `release.json` is only the static-manifest fallback for
`$UPDATE_MANIFEST_URL` overrides — keep its `latest` in sync with `package.json`'s `version`.

## Unreleased

- **Publishing can name the Sparkle signing key.** `sign_update` used to be invoked bare, which
  always signs with the `ed25519` account of the login Keychain. Three alternatives (exactly one at
  a time): `--ed-key-account <name>` for another Keychain account, `--ed-key-file <path>` for an
  exported key, and `$SPARKLE_ED_KEY` for CI — the key goes to `sign_update`'s stdin, so it stays
  out of the process list and off disk. `$SPARKLE_ED_KEY_ACCOUNT` / `$SPARKLE_ED_KEY_FILE` mirror
  the flags. With none of them set the behaviour is unchanged. See
  [Which signing key](docs/operate/publish.md#which-signing-key).

## 0.1.1

Fixes two bugs that only appear when the CLI runs from an **npm/npx install** — 0.1.0 worked from a
git clone and was broken from the registry. If you deployed with `npx alpha-gate`, re-run
`npx alpha-gate@0.1.1 deploy --instance <slug>`; your D1 data, R2 archives, and Access wiring are
preserved.

- **The deployed Worker answered every request with `Internal Server Error`** (`ReferenceError: React
  is not defined` in the logs). esbuild ignores a `tsconfig.json` that lives under `node_modules`,
  which is exactly where an npm install puts the package — so the hono/jsx transform silently fell
  back to the classic one and every view compiled to `React.createElement`. The deploy itself
  succeeded, which is why nothing caught it earlier. `--tsconfig` is now pinned on every wrangler
  command that bundles.
- **`alpha-gate` could fail to start with `spawn tsx ENOENT`** on a plain `npm install alpha-gate`
  (npx was unaffected). The launcher looked for `tsx` inside the package; npm hoists it beside the
  package. It now asks Node's resolver and runs it under the current node binary.
- **`dev` wrote all local state into the package** — the rendered config, the seed archive, and the
  whole Miniflare D1/R2. Under `npx` that is a versioned cache directory, so local data vanished
  as soon as a newer version resolved to a different one, and `$ALPHA_GATE_HOME` was a no-op for
  `dev`; a root-owned global install failed outright. It now uses the same state dir as every other
  command (`~/.alpha-gate`, or `<repo>/.deploy` from a clone).
- **`teardown --archive-dir <relative>` misplaced the pre-destroy database archive** into the package
  directory while printing the path you typed — then destroyed the instance. Relative paths are now
  anchored to the directory you ran the command in.
- **`backup` could target the wrong Cloudflare account.** It ran wrangler in your current directory
  with no config, so a `wrangler.toml` belonging to any nearby Workers project won. It is now pinned
  to the instance's own config.
- **`publish` failed on artifacts over 90 MB** given a relative path (`publish dist/MyApp.dmg`) — the
  file was looked up inside the package. It failed *after* signing, with a bare "file not found".
- **New CI job**: `npm run test:packaged` packs the tarball, installs it, runs the CLI without PATH
  help, and asserts on the bundle actually produced — it also gates the release workflow. Every bug
  above was invisible to the existing suites, which run against the checkout.

## 0.1.0

- **Back office redesign** ("quiet instrument"): the serving map makes the resolver visible; the
  Users list answers "what does each tester get next?"; confirm-name-and-return feedback loop;
  reversible revoke (Reactivate); searchable comboboxes; light/system/dark theme toggle.
- **Publishing simplified to one command**: `./publish.sh <artifact>` handles `.dmg` and signed
  `.app.zip`, links channels by name, auto-picks the instance, pre-checks the build number, and
  handles the >90 MB register path itself. (`publish-dmg.sh` and `ci-publish.sh` removed.)
- **Storage lifecycle**: per-build size + bucket total on the Builds page; purge a withdrawn build's
  archive to reclaim R2 space (the record is kept).
- **Deploy**: remembers email/Access inputs across re-runs (no silent revert); derives the Access
  team domain from the enablement redirect; reason-bearing admin 403; real `--help`.
- **Security**: service tokens are scoped to the publish surface only (decision 0006 enforced).
