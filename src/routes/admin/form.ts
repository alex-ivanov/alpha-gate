// Defensive readers for admin form POSTs (untrusted input). Shared by every mutation handler.

export function field(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parses a positive-integer id, or null for anything malformed/absent. */
export function toId(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Collects repeated form values for `name` into deduped positive-int ids — the bulk checkboxes post
 * the same field name N times, so the handler must parse with parseBody({ all: true }) (arrays).
 */
export function idList(body: Record<string, unknown>, name: string): number[] {
  const raw = body[name];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const ids = new Set<number>();
  for (const value of values) {
    const id = toId(typeof value === "string" ? value : undefined);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

export { isEmail } from "../../lib/text";
