import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { countByBuild } from "../../src/db/access-log";
import { buildDeps } from "../../src/deps";
import { resetAll } from "../support/db";
import { seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-6 (§12.3) — Redownload / reinstall. The durable /get link keeps working while the token is
// active; each install fetch serves the archive again and is logged. No admin action in between.
const deps = buildDeps(env);
beforeEach(resetAll);

describe("CUJ-6 redownload", () => {
  it("serves the same durable link twice and logs each download", async () => {
    const { token, build } = await seedServableClient(deps);
    const app = appWorker();

    expect((await app.request(`/get?token=${token}`)).status).toBe(200);
    expect(await (await app.request(`/download?token=${token}&via=install`)).text()).toBe(
      "ZIP-BYTES",
    );
    expect(await (await app.request(`/download?token=${token}&via=install`)).text()).toBe(
      "ZIP-BYTES",
    );

    expect(await countByBuild(deps.db, build.buildNumber, "download")).toBe(2);
  });
});
