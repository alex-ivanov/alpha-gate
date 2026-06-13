import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { generateToken } from "../../src/core/tokens";
import * as builds from "../../src/db/builds";
import * as clients from "../../src/db/clients";
import * as streams from "../../src/db/streams";
import { buildDeps } from "../../src/deps";
import { putArchive } from "../../src/r2/builds-bucket";
import { resetAll } from "../support/db";
import { appWorker } from "../support/worker";

// CUJ-8 (§12.7) — Multiple channels (resolve half). User A is in `stable` (#1500); user B is in
// `stable`+`beta` (#1600 in beta). Each resolves the highest build across THEIR streams. (Admin
// reassignment is exercised in M13.)
const deps = buildDeps(env);
beforeEach(resetAll);

async function sparkleVersion(token: string): Promise<string> {
  const xml = await (await appWorker().request(`/appcast?token=${token}`)).text();
  return xml.match(/<sparkle:version>(\d+)<\/sparkle:version>/)?.[1] ?? "none";
}

describe("CUJ-8 multiple channels", () => {
  it("each user resolves the highest build across only their own streams", async () => {
    const stable = await streams.create(deps.db, "stable");
    const beta = await streams.create(deps.db, "beta");

    const tokenA = generateToken();
    const tokenB = generateToken();
    const userA = await clients.insert(deps.db, { email: "a@example.test", token: tokenA });
    const userB = await clients.insert(deps.db, { email: "b@example.test", token: tokenB });
    await streams.assignUser(deps.db, userA.id, stable.id);
    await streams.assignUser(deps.db, userB.id, stable.id);
    await streams.assignUser(deps.db, userB.id, beta.id);

    const key1500 = await putArchive(deps.r2, 1500, "App.zip", "S");
    const build1500 = await builds.insert(deps.db, {
      shortVersion: "1.4.0",
      buildNumber: 1500,
      objectKey: key1500,
      edSignature: "s",
      length: 1,
    });
    await builds.linkStream(deps.db, build1500.id, stable.id);

    const key1600 = await putArchive(deps.r2, 1600, "App.zip", "B");
    const build1600 = await builds.insert(deps.db, {
      shortVersion: "1.5.0-beta",
      buildNumber: 1600,
      objectKey: key1600,
      edSignature: "b",
      length: 1,
    });
    await builds.linkStream(deps.db, build1600.id, beta.id);

    expect(await sparkleVersion(tokenA)).toBe("1500"); // stable only
    expect(await sparkleVersion(tokenB)).toBe("1600"); // highest across stable+beta
  });
});
