# Changelog

Notable changes to Alpha Gate (the tool). The deployed instance's daily self-update check polls the
npm registry's `latest` for this package and compares it against its `TOOL_VERSION`; the
dashboard/Settings link here for notes. `release.json` is only the static-manifest fallback for
`$UPDATE_MANIFEST_URL` overrides — keep its `latest` in sync with `package.json`'s `version`.

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
- **New CI job**: `npm run test:packaged` packs the tarball, installs it, and asserts on the bundle
  the CLI actually produces. Both bugs above were invisible to the existing suites, which run against
  the checkout.

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
