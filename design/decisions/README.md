# Decision records

Short ADR-style notes for choices `DESIGN.md` left open. Each: context, the decision, consequences.
When a decision changes, append to the record (don't silently rewrite) so history stays auditable.

| # | Decision | Needed by |
|---|---|---|
| [0001](0001-stack-hono-biome.md) | Routing/HTML = Hono + hono/jsx; lint/format = Biome | M0 |
| [0002](0002-token-format.md) | Token = Crockford base32, ≥160 bits, case-insensitive | M1 |
| [0003](0003-build-artifacts.md) | Two artifacts per build (DMG + signed zip); 0006 migration; R2 key layout | M0, M9, M15 |
| [0004](0004-feed-param-and-manifest.md) | Installed-build feed param `&installed=<n>`; self-update manifest shape | M10, M16 |
| [0005](0005-audit-canonicalization.md) | Versioned canonical form for the audit hash-chain; atomic writes | M5, M12 |
| [0006](0006-access-jwt.md) | Access JWT verification: RS256-pinned, fail-closed, service-token scope | M11 |
| [0007](0007-upload-size-boundary.md) | 100 MB body cap → full-upload vs metadata-only register | M15 |
| [0008](0008-informational-sentinel.md) | Informational appcast item uses a fixed sentinel version, no enclosure | M4 |
| [0009](0009-deploy-cli.md) | Deploy/teardown/dev are a TypeScript CLI (pure core + wrangler seam), not bash | §18–§19, §21, §23 |
| [0010](0010-no-build-appcast.md) | A no-build *active* user gets an empty appcast; reactivation notice is revoked/unknown only | §8, §11, §15 |
