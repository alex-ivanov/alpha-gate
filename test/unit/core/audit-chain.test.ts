import { describe, expect, it } from "vitest";
import {
  type AuditFields,
  buildHead,
  canonicalize,
  computeHash,
  linkRow,
  verifyChain,
} from "../../../src/core/audit-chain";

// §16 — tamper-evident admin audit. The chain's whole guarantee rests on a deterministic, versioned
// canonical form and SHA-256 linkage. These tests pin determinism, round-trip verification, and that
// any edit or mid-chain deletion is detected (and where).

function fields(overrides: Partial<AuditFields> = {}): AuditFields {
  return {
    actorEmail: "admin@example.test",
    action: "client.revoke",
    target: "user@example.test",
    detail: '{"reason":"abuse"}',
    ip: "203.0.113.7",
    rayId: "ray-abc",
    createdAt: "2026-06-13T12:00:00Z",
    ...overrides,
  };
}

async function chainOf(entries: AuditFields[]) {
  const rows = [];
  let prev: string | null = null;
  for (const entry of entries) {
    const row = await linkRow(prev, entry);
    rows.push(row);
    prev = row.hash;
  }
  return rows;
}

describe("canonicalize", () => {
  it("is byte-stable across calls for the same entry", () => {
    const entry = { ...fields(), prevHash: null };
    expect(canonicalize(entry)).toBe(canonicalize(entry));
  });

  it("distinguishes null from empty string (length-prefixed, no ambiguity)", () => {
    const withNull = canonicalize({ ...fields({ target: null }), prevHash: null });
    const withEmpty = canonicalize({ ...fields({ target: "" }), prevHash: null });
    expect(withNull).not.toBe(withEmpty);
  });

  it("cannot be forged by a value containing the field delimiter", () => {
    const sneaky = canonicalize({ ...fields({ action: "x\nactor:99:evil" }), prevHash: null });
    const honest = canonicalize({ ...fields({ action: "x" }), prevHash: null });
    expect(sneaky).not.toBe(honest);
  });
});

describe("computeHash", () => {
  it("is deterministic and changes when any field changes", async () => {
    const base = { ...fields(), prevHash: null };
    expect(await computeHash(base)).toBe(await computeHash(base));
    expect(await computeHash(base)).not.toBe(
      await computeHash({ ...fields({ action: "client.reissue" }), prevHash: null }),
    );
  });
});

describe("verifyChain", () => {
  it("accepts an untampered chain", async () => {
    const rows = await chainOf([fields(), fields({ action: "build.withdraw" }), fields()]);
    expect(await verifyChain(rows)).toEqual({ ok: true });
  });

  it("detects an edited row at its index", async () => {
    const rows = await chainOf([fields(), fields({ action: "build.withdraw" }), fields()]);
    const tampered = rows.map((row, i) => (i === 1 ? { ...row, action: "build.restore" } : row));
    expect(await verifyChain(tampered)).toEqual({ ok: false, brokenIndex: 1 });
  });

  it("detects a deleted middle row via the broken prev_hash link", async () => {
    const first = await linkRow(null, fields());
    const middle = await linkRow(first.hash, fields({ action: "b" }));
    const last = await linkRow(middle.hash, fields({ action: "c" }));
    expect(await verifyChain([first, last])).toEqual({ ok: false, brokenIndex: 1 });
  });
});

describe("buildHead", () => {
  it("returns the last hash and the row count (the anchor head, §16)", async () => {
    const first = await linkRow(null, fields());
    const second = await linkRow(first.hash, fields({ action: "b" }));
    expect(buildHead([first, second])).toEqual({ hash: second.hash, count: 2 });
  });

  it("returns an empty head for an empty chain", () => {
    expect(buildHead([])).toEqual({ hash: "", count: 0 });
  });
});
