import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildDeps } from "../../src/deps";
import { resetAll } from "../support/db";
import { publishBuild, seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-7 (§12.4) — Forced/critical update. A critical build sets sparkle:criticalUpdate so Sparkle
// prompts insistently; a non-critical build omits it. Same delivery path as a normal update.
const deps = buildDeps(env);
beforeEach(resetAll);

describe("CUJ-7 critical update", () => {
  it("marks the item with an empty sparkle:criticalUpdate when the top build is critical", async () => {
    const { token, stream } = await seedServableClient(deps, { buildNumber: 1500 });
    await publishBuild(deps, stream.id, { buildNumber: 1600, critical: true });

    const xml = await (await appWorker().request(`/appcast?token=${token}`)).text();
    expect(xml).toContain("<sparkle:criticalUpdate></sparkle:criticalUpdate>");
  });

  it("omits criticalUpdate entirely for a non-critical top build", async () => {
    const { token } = await seedServableClient(deps, { buildNumber: 1500 });

    const xml = await (await appWorker().request(`/appcast?token=${token}`)).text();
    expect(xml).not.toContain("criticalUpdate");
  });
});
