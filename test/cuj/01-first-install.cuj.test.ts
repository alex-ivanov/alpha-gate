import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { countByBuild } from "../../src/db/access-log";
import { buildDeps } from "../../src/deps";
import { resetAll } from "../support/db";
import { seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-1 (§12.1) — First install. Admin creates a client → durable /get link → user downloads the
// archive → (the /appcast "up to date" half is asserted in CUJ-2, M10).
const deps = buildDeps(env);
beforeEach(resetAll);

describe("CUJ-1 first install", () => {
  it("renders the landing page with download, the activate deep link, and the paste token", async () => {
    const { token } = await seedServableClient(deps);

    const res = await appWorker().request(`/get?token=${token}`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("Download");
    expect(html).toContain(`myapp://activate?token=${token}`);
    expect(html).toContain(token); // paste fallback
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("streams the archive from R2 and logs exactly one download event", async () => {
    const { token, build } = await seedServableClient(deps);

    const res = await appWorker().request(`/download?token=${token}&via=install`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ZIP-BYTES");

    expect(await countByBuild(deps.db, build.buildNumber, "download")).toBe(1);
    expect(await countByBuild(deps.db, build.buildNumber, "update")).toBe(0);
  });

  it("serves the DMG for via=install when the build has one", async () => {
    const { token } = await seedServableClient(deps, { withDmg: true });

    const res = await appWorker().request(`/download?token=${token}&via=install`);
    expect(await res.text()).toBe("DMG-BYTES");
  });
});
