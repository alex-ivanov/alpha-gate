import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateToken } from "../../src/core/tokens";
import * as builds from "../../src/db/builds";
import * as clients from "../../src/db/clients";
import * as streams from "../../src/db/streams";
import { buildDeps } from "../../src/deps";
import { putArchive } from "../../src/r2/builds-bucket";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../support/access";
import { resetAll } from "../support/db";
import { appWorker } from "../support/worker";

// CUJ-8 (§12.7) — Multiple channels. Each user resolves the highest build across THEIR streams;
// moving a user between channels (admin reassign) changes resolution on the next check.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
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

  it("admin reassign (unassign beta) drops user B back to the stable build", async () => {
    const stable = await streams.create(deps.db, "stable");
    const beta = await streams.create(deps.db, "beta");
    const token = generateToken();
    const userB = await clients.insert(deps.db, { email: "b@example.test", token });
    await streams.assignUser(deps.db, userB.id, stable.id);
    await streams.assignUser(deps.db, userB.id, beta.id);

    const key1500 = await putArchive(deps.r2, 1500, "App.zip", "S");
    const b1500 = await builds.insert(deps.db, {
      shortVersion: "1.4.0",
      buildNumber: 1500,
      objectKey: key1500,
      edSignature: "s",
      length: 1,
    });
    await builds.linkStream(deps.db, b1500.id, stable.id);
    const key1600 = await putArchive(deps.r2, 1600, "App.zip", "B");
    const b1600 = await builds.insert(deps.db, {
      shortVersion: "1.5.0-beta",
      buildNumber: 1600,
      objectKey: key1600,
      edSignature: "b",
      length: 1,
    });
    await builds.linkStream(deps.db, b1600.id, beta.id);

    expect(await sparkleVersion(token)).toBe("1600"); // stable + beta

    await adminWorker(access).request(
      `/admin/clients/${userB.id}/streams/unassign`,
      withTokenForm(await access.signValidUser(), { streamId: String(beta.id) }),
    );

    expect(await sparkleVersion(token)).toBe("1500"); // now stable only
  });
});
