// Small format helpers shared across layers (no bindings, no I/O).

/** Conservative email shape check: a single @, non-empty whitespace-free parts, a dotted domain. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
