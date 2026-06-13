import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getByBuildNumber,
  getById,
  insert,
  linkStream,
  listAll,
  listAvailable,
  listBuildStreams,
  setCritical,
  setStatus,
  unlinkStream,
} from "../../../src/db/builds";
import { create as createStream } from "../../../src/db/streams";
import { cleanDb } from "../../support/db";

const db = env.DB;

function newBuild(buildNumber: number, overrides = {}) {
  return {
    shortVersion: "1.0.0",
    buildNumber,
    objectKey: `build/${buildNumber}/App.zip`,
    edSignature: "sig",
    length: 1024,
    ...overrides,
  };
}

beforeEach(cleanDb);

describe("builds db", () => {
  it("inserts with defaults (available, non-critical, no DMG) and maps the row", async () => {
    const build = await insert(db, newBuild(1500));

    expect(build.buildNumber).toBe(1500);
    expect(build.status).toBe("available");
    expect(build.critical).toBe(false);
    expect(build.dmgObjectKey).toBeNull();
    expect((await getByBuildNumber(db, 1500))?.id).toBe(build.id);
  });

  it("persists the optional DMG artifact and critical flag", async () => {
    const build = await insert(
      db,
      newBuild(1600, { critical: true, dmgObjectKey: "build/1600/App.dmg", dmgLength: 4096 }),
    );
    expect(build.critical).toBe(true);
    expect(build.dmgObjectKey).toBe("build/1600/App.dmg");
    expect(build.dmgLength).toBe(4096);
  });

  it("listAvailable excludes withdrawn builds; listAll keeps them in build_number order", async () => {
    const a = await insert(db, newBuild(1400));
    await insert(db, newBuild(1600));
    await setStatus(db, a.id, "withdrawn");

    expect((await listAvailable(db)).map((b) => b.buildNumber)).toEqual([1600]);
    expect((await listAll(db)).map((b) => b.buildNumber)).toEqual([1400, 1600]);
  });

  it("toggles critical", async () => {
    const a = await insert(db, newBuild(1500));
    await setCritical(db, a.id, true);
    expect((await getById(db, a.id))?.critical).toBe(true);
  });

  it("links and unlinks streams (idempotent insert) and lists the links", async () => {
    const a = await insert(db, newBuild(1500));
    const stable = await createStream(db, "stable"); // FK: the stream must exist first
    const beta = await createStream(db, "beta");

    await linkStream(db, a.id, stable.id);
    await linkStream(db, a.id, stable.id); // OR IGNORE — no duplicate
    await linkStream(db, a.id, beta.id);

    expect(await listBuildStreams(db)).toEqual(
      expect.arrayContaining([
        { buildId: a.id, streamId: stable.id },
        { buildId: a.id, streamId: beta.id },
      ]),
    );
    expect(await listBuildStreams(db)).toHaveLength(2);

    await unlinkStream(db, a.id, stable.id);
    expect(await listBuildStreams(db)).toEqual([{ buildId: a.id, streamId: beta.id }]);
  });
});
