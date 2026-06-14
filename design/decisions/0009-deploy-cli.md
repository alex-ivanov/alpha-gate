# 0009 — Deploy/teardown/dev are a TypeScript CLI, not bash

**Status:** accepted · **Date:** 2026-06-14

## Context
§18–§19, §21, and §23 originally specced the operator surface as bash scripts: `deploy.sh`
text-scraped `wrangler` output (`d1 list --json | jq`, `r2 bucket list | grep`, a `grep -oE` over
`wrangler deploy`'s human output for the URL), rendered the two configs with `envsubst` over
`deploy/wrangler.template.toml`, and wrote `.deploy/<slug>.state.json` with `jq`. An audit of the live
scripts found this fragile in ways that bit repeatedly:

- **Text-scraping wrangler.** `r2 bucket list | grep` never matched the real list format, so a re-deploy
  tried to *re-create* an existing bucket and failed with error 10004 (idempotency was broken).
- **No validation/preflight gates** — a missing `jq`, an unauthenticated `wrangler`, or an empty Access
  team domain surfaced as a cryptic mid-run error (the "Forbidden" admin came from empty
  `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` secrets the operator had left blank at a prompt).
- **No test net.** Nothing could exercise the provisioning logic offline; every change was validated by
  deploying for real.
- **Write-only state + bash portability** (associative arrays, `set -euo pipefail` corner cases).

Terraform/Pulumi would make it declarative but need a Cloudflare **API token** — explicitly excluded by
the "pure wrangler, no API token/DNS/zone" constraint (§19). So imperative orchestration is unavoidable;
the question was only *what language*.

## Decision
Reimplement `deploy` / `teardown` / `dev` as a **TypeScript CLI** under `src/deploy/`, run via `tsx`
(a devDependency — `npm install` is the only setup; **`jq` and `envsubst` are gone**). The three
`deploy/*.sh` files become three-line wrappers that `exec npx tsx src/deploy/cli.ts <command> "$@"`, so
the published command surface and flags are unchanged; the old bash bodies live in git history.

Structure mirrors the app's pure-core/seams rule (§23, [CANONICAL-LAYOUT](../CANONICAL-LAYOUT.md)):

- **`core/`** — pure, I/O-free, unit-tested with zero runtime: `args` (parse/validate flags + slug),
  `config` (`renderConfig` builds the wrangler.toml in TS, escaping values — **replaces the
  `envsubst` template**), `parse` (defensive readers for `d1 list --json`, `secret list`,
  `r2 bucket info`, and the deploy-URL scrape — garbled input → `null`/`[]`, never a throw), `plan`
  (inspection findings → create/skip/update steps + idempotent seed SQL), `state` (serialize/parse the
  ledger), and the grouped-panels UI (`table`, `colors`, `ui` — width measured on plain text, ANSI
  applied after padding).
- **`seams/`** — the only I/O: `wrangler` (spawns `wrangler` with **argv arrays**, never a shell string,
  so no injection; `run()` captures stdout/stderr/code and never rejects, `exec()` inherits stdio for
  long-running `wrangler dev`; a `--dry-run` wrangler logs and no-ops), `files`, `io` (prompts), `clock`.
- **`commands/`** — orchestration: a transparent **inspect → apply** model. Preflight (Node ≥ 20 +
  `wrangler whoami`) → a read-only INSPECT pass → render the APPLY plan and the exact commands → confirm
  gate → mutate, with live `→`/`✓` per-step progress. Manual steps (enable Access in the dashboard) print
  instructions and **wait for the operator to confirm done**.

Idempotency comes from inspection (create-only-if-absent via `r2 bucket info` / `d1 list`, seed only on a
fresh DB via `INSERT OR IGNORE`), not from scraping. The on-disk state ledger keeps the old snake_case
keys (`instance`, `app_url`, `admin_url`, `d1_id`) so `publish.sh`/`teardown.sh` stay compatible.

Tooling is dual: `tsconfig.deploy.json` (`types: ["node"]`) and a node-env vitest project
(`test/vitest.deploy.config.ts`) sit alongside the app's workers-types config; `npm test` and
`npm run typecheck` run both suites. `Date` stays banned (the clock seam is the one allow-listed file).

## Consequences
- **Offline-testable provisioning** — `test/deploy/*` drives the commands against a fake wrangler
  (asserting the exact argv) and a fake filesystem; the bucket-10004 regression and empty-Access-domain
  failure are now covered by tests instead of discovered in production.
- `wrangler deploy` has **no `--json`**, so the URL scrape (`extractDeployUrl`) is unavoidable — but it is
  now a pure, tested function that fails loudly (null → hard error) instead of silently producing an empty
  URL. `d1/r2 create --update-config` exists but was **not** adopted: it conflicts with rendering the two
  ephemeral configs ourselves.
- `deploy/wrangler.template.toml` is deleted; `renderConfig` is the single source of truth for the config
  shape (the §18 listing documents that shape).
- New developer prerequisite is just **Node ≥ 20** (tsx ships as a devDependency). The `deploy/*.sh`
  wrappers remain so muscle-memory and docs keep working; `shellcheck` still lints the wrappers.
