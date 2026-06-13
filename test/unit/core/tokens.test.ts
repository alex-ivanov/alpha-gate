import { describe, expect, it } from "vitest";
import { generateToken, isWellFormedToken, normalizeToken } from "../../../src/core/tokens";

// Decision 0002: the token is the sole credential, lives in URLs AND is hand-pasted into the macOS
// app. So it is a 32-char Crockford base32 string (≥160 bits, unambiguous alphabet, case-insensitive).
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U

describe("generateToken", () => {
  it("produces a 32-char Crockford base32 token (160 bits over a 32-symbol alphabet)", () => {
    const token = generateToken();

    expect(token).toHaveLength(32);
    expect([...token].every((ch) => CROCKFORD_ALPHABET.includes(ch))).toBe(true);
    expect(CROCKFORD_ALPHABET).toHaveLength(32); // 32 symbols × 32 chars = 160 bits
  });

  it("is accepted by its own well-formedness check", () => {
    expect(isWellFormedToken(generateToken())).toBe(true);
  });

  it("is already normalized (round-trips through normalizeToken unchanged)", () => {
    const token = generateToken();
    expect(normalizeToken(token)).toBe(token);
  });

  it("yields distinct tokens across many draws", () => {
    const draws = Array.from({ length: 1000 }, () => generateToken());
    expect(new Set(draws).size).toBe(draws.length);
  });
});

describe("normalizeToken", () => {
  it("strips whitespace and hyphens and upper-cases", () => {
    expect(normalizeToken("  abcd-efgh jkmn ")).toBe("ABCDEFGHJKMN");
  });

  it("maps the Crockford confusables O→0 and I/L→1 so paste is forgiving", () => {
    expect(normalizeToken("OIL")).toBe("011");
  });

  it("is idempotent", () => {
    const messy = "o0i1L-abc def";
    expect(normalizeToken(normalizeToken(messy))).toBe(normalizeToken(messy));
  });
});

describe("isWellFormedToken", () => {
  const valid = generateToken();

  it.each([
    { name: "a freshly generated token", input: valid, expected: true },
    {
      name: "the same token lower-cased (normalized on the way in)",
      input: valid.toLowerCase(),
      expected: true,
    },
    { name: "empty string", input: "", expected: false },
    { name: "too short", input: "ABCDEF", expected: false },
    { name: "too long", input: `${valid}EXTRA`, expected: false },
    {
      name: "contains U (outside the Crockford alphabet)",
      input: `${valid.slice(0, 31)}U`,
      expected: false,
    },
    { name: "contains a symbol", input: `${valid.slice(0, 31)}!`, expected: false },
  ])("$name → $expected", ({ input, expected }) => {
    expect(isWellFormedToken(input)).toBe(expected);
  });
});
