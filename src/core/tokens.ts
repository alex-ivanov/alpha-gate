// Per-user access tokens (decision 0002). The sole credential: it travels in URLs and is hand-pasted
// into the macOS app on first launch, so it uses an unambiguous, case-insensitive Crockford base32
// alphabet and ≥160 bits of entropy. This module is the single source of truth for token shape.

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 symbols — no I, L, O, U
const TOKEN_BYTES = 20; // 160 bits of entropy
const TOKEN_LENGTH = 32; // 160 bits / 5 bits-per-symbol, exact (no padding)

/** A fresh, well-formed, already-normalized token. */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return encodeCrockford(bytes);
}

/**
 * Canonical form for lookup: forgiving of case, whitespace/hyphens, and the Crockford confusables
 * (O→0, I/L→1) so a human paste still matches. Idempotent.
 */
export function normalizeToken(raw: string): string {
  return raw
    .replace(/[\s-]+/g, "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** Defensive guard run before any DB lookup: exactly 32 chars, all in the Crockford alphabet. */
export function isWellFormedToken(raw: string): boolean {
  const normalized = normalizeToken(raw);
  if (normalized.length !== TOKEN_LENGTH) return false;
  for (const ch of normalized) {
    if (!CROCKFORD_ALPHABET.includes(ch)) return false;
  }
  return true;
}

function encodeCrockford(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET.charAt((value >>> bits) & 31);
    }
  }
  // 160 bits is a multiple of 5, so there is never a trailing remainder for our fixed size.
  return out;
}
