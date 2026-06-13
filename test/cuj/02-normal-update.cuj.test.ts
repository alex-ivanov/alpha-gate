import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { countByBuild, currentBuild } from "../../src/db/access-log";
import { buildDeps } from "../../src/deps";
import { resetAll } from "../support/db";
import { publishBuild, seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-2 (§12.2) — Normal update. A higher build is published into the user's stream; the next
// /appcast resolves it, records the installed build on the check, and /download?via=update serves it.
const deps = buildDeps(env);
beforeEach(resetAll);

describe("CUJ-2 normal update", () => {
  it("resolves the newly published higher build and logs a check with the installed build", async () => {
    const { token, client, stream } = await seedServableClient(deps, {
      buildNumber: 1500,
      shortVersion: "1.4.0",
    });
    await publishBuild(deps, stream.id, { buildNumber: 1600, shortVersion: "1.5.0" });

    const res = await appWorker().request(`/appcast?token=${token}&installed=1500`);
    const xml = await res.text();
    expect(xml).toContain("<sparkle:version>1600</sparkle:version>");
    expect(xml).toContain("<sparkle:shortVersionString>1.5.0</sparkle:shortVersionString>");
    expect(xml).toContain(`token=${token}&amp;via=update`);

    // The check recorded what the app reported it was running.
    expect(await currentBuild(deps.db, client.id)).toBe(1500);
  });

  it("serves the new build via=update and logs one update event", async () => {
    const { token, stream } = await seedServableClient(deps, { buildNumber: 1500 });
    await publishBuild(deps, stream.id, { buildNumber: 1600, zipBody: "NEW-ZIP" });

    const res = await appWorker().request(`/download?token=${token}&via=update`);
    expect(await res.text()).toBe("NEW-ZIP");
    expect(await countByBuild(deps.db, 1600, "update")).toBe(1);
    expect(await countByBuild(deps.db, 1600, "download")).toBe(0);
  });
});
