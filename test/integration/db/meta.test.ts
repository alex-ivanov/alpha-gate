import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { get, getAll, set } from "../../../src/db/meta";
import { cleanDb } from "../../support/db";

const db = env.DB;
beforeEach(cleanDb);

describe("meta db", () => {
  it("returns null for a missing key", async () => {
    expect(await get(db, "app_name")).toBeNull();
  });

  it("inserts then upserts a key", async () => {
    await set(db, "app_name", "Acme");
    expect(await get(db, "app_name")).toBe("Acme");
    await set(db, "app_name", "Beta");
    expect(await get(db, "app_name")).toBe("Beta");
  });

  it("returns all set keys via getAll", async () => {
    await set(db, "a", "1");
    await set(db, "b", "2");
    expect(await getAll(db)).toEqual({ a: "1", b: "2" });
  });
});
