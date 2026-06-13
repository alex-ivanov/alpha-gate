# Alpha Gate

A lightweight, self-hosted distribution gate for a notarized macOS app updated via Sparkle. Runs
entirely on Cloudflare (Workers + D1 + R2) within the free tier: it gates downloads and the Sparkle
update feed behind a per-user token, manages clients from an admin page behind Cloudflare Access, and
supports release streams, pinned versions, and rollback.

## Status

Under construction. See:

- **`design/DESIGN.md`** — the architecture and behavior spec (source of truth).
- **`design/PLAN.md`** — the implementation plan and milestone checklist.
- **`design/CANONICAL-LAYOUT.md`** — the module tree and structural rules.
- **`design/decisions/`** — decision records for choices the spec left open.
- **`CLAUDE.md`** — working guidance and conventions.

## Develop

```bash
npm install
npm test          # vitest-pool-workers; runs everything offline, no Cloudflare account
npm run typecheck # tsc --noEmit (strict)
npm run lint      # biome check
npm run format    # biome format --write
npm run check     # lint + typecheck + test
```
