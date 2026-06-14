// A tiny Result type so the pure validators/parsers report failure as data (with a fix-it hint) rather
// than throwing — the command layer turns an error Result into the same "→ what to do" output as the
// preflight, and tests assert on it directly.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; hint?: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(error: string, hint?: string): Result<T> {
  return hint === undefined ? { ok: false, error } : { ok: false, error, hint };
}
