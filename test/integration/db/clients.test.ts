import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  findByToken,
  getById,
  insert,
  list,
  setPinnedBuild,
  setStatus,
  setToken,
} from "../../../src/db/clients";
import { cleanDb } from "../../support/db";

// Integration: real prepared statements against the seeded D1 (migrations applied in setup.ts).
const db = env.DB;

beforeEach(cleanDb);

describe("clients db", () => {
  it("inserts with sensible defaults and returns the row", async () => {
    const client = await insert(db, { email: "a@example.test", token: "TOK_A" });

    expect(client.id).toBeGreaterThan(0);
    expect(client.email).toBe("a@example.test");
    expect(client.status).toBe("active");
    expect(client.pinnedBuildId).toBeNull();
    expect(client.label).toBeNull();
  });

  it("finds by token, and returns null for an unknown token", async () => {
    await insert(db, { email: "a@example.test", token: "TOK_A", label: "Alice" });

    const found = await findByToken(db, "TOK_A");
    expect(found?.email).toBe("a@example.test");
    expect(found?.label).toBe("Alice");
    expect(await findByToken(db, "NOPE")).toBeNull();
  });

  it("gets by id and lists in id order", async () => {
    const a = await insert(db, { email: "a@example.test", token: "TOK_A" });
    const b = await insert(db, { email: "b@example.test", token: "TOK_B" });

    expect((await getById(db, a.id))?.email).toBe("a@example.test");
    expect((await list(db)).map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("revokes via setStatus", async () => {
    const a = await insert(db, { email: "a@example.test", token: "TOK_A" });
    await setStatus(db, a.id, "revoked");
    expect((await getById(db, a.id))?.status).toBe("revoked");
  });

  it("re-issues a token: the old token stops matching, the new one matches", async () => {
    const a = await insert(db, { email: "a@example.test", token: "OLD" });
    await setToken(db, a.id, "NEW");

    expect(await findByToken(db, "OLD")).toBeNull();
    expect((await findByToken(db, "NEW"))?.id).toBe(a.id);
  });

  it("sets and clears the pinned build", async () => {
    const a = await insert(db, { email: "a@example.test", token: "TOK_A" });

    await setPinnedBuild(db, a.id, 1500);
    expect((await getById(db, a.id))?.pinnedBuildId).toBe(1500);

    await setPinnedBuild(db, a.id, null);
    expect((await getById(db, a.id))?.pinnedBuildId).toBeNull();
  });
});
