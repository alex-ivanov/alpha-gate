// The single sanctioned source of wall-clock time. Everything that records or compares time takes a
// Clock so tests can seed it; no other module may call `new Date()` / `Date.now()` (Biome enforces
// this — see biome.json). D1's own `datetime('now')` defaults are fine for columns no test asserts on.

export type Clock = () => string; // ISO-8601 UTC, e.g. "2026-06-13T12:00:00.000Z"

export const systemClock: Clock = () => new Date().toISOString();

/** Current Unix time in whole seconds — for JWT exp/nbf checks. The only other sanctioned Date use. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** ISO-8601 UTC for `days` ago — the §16 log-prune cutoff. */
export const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString();
