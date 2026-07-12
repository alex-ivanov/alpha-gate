# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Alpha Gate is a self-hosted distribution gate for a notarized macOS app updated via **Sparkle**. It gates downloads and the Sparkle update feed behind a per-user token, with an admin back office for managing clients, builds, release streams, pins, and rollbacks. It runs entirely on **Cloudflare (Workers + D1 + R2)** within the free tier, deployable to any account from one script.

## Guidence

- The durable principles & constraints are in ./docs/PRINCIPLES.md — use that as the main guidance. Operator how-to is in ./docs/ONBOARDING.md and ./docs/UPLOADING.md. When a decision is needed from the user which is not surfaced from the docs, gather all information and make the user decide. (The old ./design/ spec was removed; code comments still cite its §N section numbers as historical anchors.)
- Create and use checklists and plan the work before commiting to do it. Cross validate the plan and check the work against the plan. Make sure plans are up to date. If a blocker of dead end discovered - update the plan with the new information and reassess.
- Record notable decisions and durable invariants in ./docs/ (PRINCIPLES for invariants; ONBOARDING/UPLOADING for operator how-to). Treat documentation on the same level as code and keep it up to date and update often.
- Split the work in small chunks, commit often. Run tests before the submission to make sure they are green. Add a line to commit message about test status.
- Don't mention your name on the commit messages, just what has been done. 
- Use defensive programming and TDD for the development. Use CUJ as the gates of the features.
- Make sure all test AND ESPECIALLY CUJ are extermely human readable, comprehansible and auditable - these are the abstractions needed to understand the code. 
- Split the work into abstractions when the code is complicated. 
- Kepp package and file sizes under control and split up when you get them unreadable. 
- Use isolation of concerns as much as you can.


## Constraints that bite repeatedly

- **Sparkle cannot downgrade.** An item below the installed version is never offered. So "rollback" = **roll-forward**: rebuild old code with a *higher* `build_number` (§9). The same no-downgrade rule means pinning below the installed build, or moving a user to a stream whose top build is lower, won't take effect until a higher-numbered build exists — this also produces the **no-build state** (§11), which admin actions surface and confirm rather than block.

- **Workers never sign and never hold a signing key.** All three signatures (Developer ID + notarization, Sparkle EdDSA, optional feed signature) are produced on **macOS** during publish (§14, §20). The Worker only pastes the fixed per-archive EdDSA string into each appcast and streams bytes. `SURequireSignedFeed` is **off** for alpha (it's incompatible with per-user dynamic feeds — would put the signing key on the edge).

- **The token is never embedded in the binary.** It would break the notarization seal. The token reaches the app out-of-band via deep link (`myapp://activate?token=`) or paste on first launch (§7). The build is generic and signed once.

- **Never hand out raw R2 or pre-signed download URLs.** Everything routes through `/download?token=` so logging and instant revocation hold (§16).

- **`build_number` is the machine-comparable monotonic key** (Sparkle's `sparkle:version`); `short_version` is the human string. They diverge during rollback. Build metadata lives in **D1** (the resolver queries by stream/status/version order); R2 holds only the archive bytes.

## Design for testability (§23)

Keep I/O at the edges and logic pure. The resolver, the no-build computation, §11 validation, the audit hash-chain build/verify, and appcast XML generation must be **plain functions over plain data** (no bindings) so most logic is testable with zero runtime. Tests use `@cloudflare/vitest-pool-workers` (runs in `workerd`/Miniflare, isolated per-test storage, offline). What Miniflare can't simulate — Access JWT, email, outbound HTTP — sits behind injectable seams/mocks. Note beta caveats: coverage is Istanbul (not V8), and fake timers don't reach the KV/R2 simulators, so use seeded timestamps for time-dependent tests.

## Commands

# Two channels, same CLI: `npx alpha-gate <cmd>` (npm, state in ~/.alpha-gate) OR `./deploy/*.sh` (clone).
```bash
npm test                                      # both suites: worker (vitest-pool-workers) + deploy CLI (node); offline
npm run check                                 # the full gate: biome + typecheck (both tsconfigs) + test

./deploy/dev.sh                               # §23 local surface: BOTH Workers on Miniflare (app :8787, admin :8788),
                                              #   seeded, no account (--role app|admin for one)
./deploy/deploy.sh --instance <slug>          # provision D1 + R2, apply migrations, deploy both Workers (idempotent;
                                              #   re-run updates in place — data + remembered email/Access preserved)
./deploy/deploy.sh --instance <slug> --email-provider cloudflare --email-from alpha@<sending-domain>
./deploy/backup.sh --instance <slug>          # D1 dump to .deploy/<slug>-<ts>.sql (recovery; contains live tokens)
./deploy/teardown.sh --instance <slug>        # destructive: archives D1 first, removes both Workers + D1 (R2/Access manual)

./publish.sh MyApp.dmg                        # macOS: ONE command — reads version from the app (dmg OR
                                              #   .app.zip), sign_update, links --channel <name>, uploads.
                                              #   Auto-picks the instance when only one is deployed; handles
                                              #   the >90 MB register path itself via your wrangler auth.
./publish.sh MyApp.zip --channel beta --critical   # a signed .app .zip into a channel by NAME
```

Deployment is a **TypeScript CLI** (`src/deploy/`, run via `tsx` from the thin `deploy/*.sh` wrappers; decision 0009) over **pure wrangler** (`wrangler login` once; no `jq`/`envsubst`) — no API token, DNS, or zone. The two things a script can't do are printed as a one-time checklist: enable Cloudflare Access on the admin hostname + allowlist your email, then feed `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` back as secrets (§19). All publish paths (the one `publish.sh` — locally or in CI — and the browser Upload page) converge on `POST /admin/builds/upload|register`.
