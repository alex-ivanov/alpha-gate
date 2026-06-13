import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countByBuild,
  currentBuild,
  insertEvent,
  lastEventAt,
  prune,
} from "../../../src/db/access-log";
import { cleanDb } from "../../support/db";

const db = env.DB;

beforeEach(cleanDb);

describe("access-log db", () => {
  it("counts downloads and updates per build", async () => {
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "download",
      buildNumber: 1500,
      createdAt: "2026-06-01T00:00:00Z",
    });
    await insertEvent(db, {
      clientId: 2,
      email: "b@x",
      event: "download",
      buildNumber: 1500,
      createdAt: "2026-06-02T00:00:00Z",
    });
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "update",
      buildNumber: 1500,
      createdAt: "2026-06-03T00:00:00Z",
    });

    expect(await countByBuild(db, 1500, "download")).toBe(2);
    expect(await countByBuild(db, 1500, "update")).toBe(1);
    expect(await countByBuild(db, 9999, "download")).toBe(0);
  });

  it("reports the latest time of an event for a client", async () => {
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "update",
      buildNumber: 1500,
      createdAt: "2026-06-01T00:00:00Z",
    });
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "update",
      buildNumber: 1600,
      createdAt: "2026-06-05T00:00:00Z",
    });

    expect(await lastEventAt(db, 1, "update")).toBe("2026-06-05T00:00:00Z");
    expect(await lastEventAt(db, 1, "download")).toBeNull();
  });

  it("reports the build_number from the client's most recent check", async () => {
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "check",
      buildNumber: 1400,
      createdAt: "2026-06-01T00:00:00Z",
    });
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "check",
      buildNumber: 1500,
      createdAt: "2026-06-09T00:00:00Z",
    });

    expect(await currentBuild(db, 1)).toBe(1500);
    expect(await currentBuild(db, 2)).toBeNull();
  });

  it("prunes only rows older than the cutoff (§16 retention)", async () => {
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "check",
      buildNumber: 1500,
      createdAt: "2026-01-01T00:00:00Z", // old
    });
    await insertEvent(db, {
      clientId: 1,
      email: "a@x",
      event: "check",
      buildNumber: 1500,
      createdAt: "2026-06-10T00:00:00Z", // recent
    });

    await prune(db, "2026-03-01T00:00:00Z");

    // Only the recent check survives.
    expect(await currentBuild(db, 1)).toBe(1500);
    expect(await lastEventAt(db, 1, "check")).toBe("2026-06-10T00:00:00Z");
  });
});
