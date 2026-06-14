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

export { isEmail } from "../../lib/text";
