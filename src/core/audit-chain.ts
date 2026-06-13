// §16 — tamper-evident admin audit hash chain (decision 0005). Pure over plain data (crypto.subtle
// is used but only over passed-in values). The canonical form is versioned and length-prefixed so it
// is deterministic and reproducible offline in any language — the basis for the anchor + verification.

const CANON_VERSION = "v1";

/** The audited content of one mutation (everything except the autoincrement id and the hash). */
export interface AuditFields {
  actorEmail: string;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  rayId: string | null;
  createdAt: string;
}

/** An entry ready to hash: the fields plus the link to the previous row. */
export interface AuditEntry extends AuditFields {
  prevHash: string | null;
}

/** A stored, hashed row. */
export interface AuditRow extends AuditEntry {
  hash: string;
}

export type VerifyResult = { ok: true } | { ok: false; brokenIndex: number };

// Fixed field order. `prevHash` is part of the canonical input (chain linkage); `id` and `hash` are
// excluded. Changing the order or set is a breaking change — bump CANON_VERSION if it ever happens.
const FIELD_ORDER = [
  "actorEmail",
  "action",
  "target",
  "detail",
  "ip",
  "rayId",
  "createdAt",
  "prevHash",
] as const satisfies readonly (keyof AuditEntry)[];

const encoder = new TextEncoder();

/**
 * Deterministic canonical form: version tag, then each field as `name:<utf8-byte-length>:<value>`
 * (or `name:null`). Length-prefixing means no value — even one containing newlines or colons — can
 * forge a field boundary.
 */
export function canonicalize(entry: AuditEntry): string {
  const parts: string[] = [CANON_VERSION];
  for (const field of FIELD_ORDER) {
    const value = entry[field];
    if (value === null) {
      parts.push(`${field}:null`);
    } else {
      parts.push(`${field}:${encoder.encode(value).length}:${value}`);
    }
  }
  return parts.join("\n");
}

export async function computeHash(entry: AuditEntry): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalize(entry)));
  return toHex(digest);
}

/** Builds the next row: links it to `prevHash` and computes its hash. */
export async function linkRow(prevHash: string | null, fields: AuditFields): Promise<AuditRow> {
  const entry: AuditEntry = { ...fields, prevHash };
  const hash = await computeHash(entry);
  return { ...entry, hash };
}

/**
 * Recomputes each row's hash from its fields and checks both the recomputed hash and the prev_hash
 * link. Returns the index of the first row that fails (catching edits and mid-chain deletions).
 */
export async function verifyChain(rows: readonly AuditRow[]): Promise<VerifyResult> {
  let prev: string | null = null;
  for (const [index, row] of rows.entries()) {
    if (row.prevHash !== prev) return { ok: false, brokenIndex: index };
    if ((await computeHash(row)) !== row.hash) return { ok: false, brokenIndex: index };
    prev = row.hash;
  }
  return { ok: true };
}

/** The chain head for anchoring (§16): the latest hash and the row count. */
export function buildHead(rows: readonly AuditRow[]): { hash: string; count: number } {
  const last = rows.at(-1);
  return { hash: last?.hash ?? "", count: rows.length };
}

function toHex(buffer: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(buffer)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
