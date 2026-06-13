import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getById } from "../../src/db/builds";
import { buildDeps } from "../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../support/access";
import { resetAll } from "../support/db";
import { seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-11 (§11) — A withdraw that would strand users is confirmed, not blocked. Without confirm it
// returns the affected list and makes NO change; with confirm it proceeds and the user is knowingly
// left no-build (their /appcast then returns the informational notice).
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

describe("CUJ-11 no-build confirmation", () => {
  it("withdrawing the only build requires confirmation and lists the affected user", async () => {
    const { token, build } = await seedServableClient(deps, { email: "alice@example.test" });
    const userToken = await access.signValidUser();

    // Without confirm: confirmation page, no change.
    const confirm = await adminWorker(access).request(
      `/admin/builds/${build.id}/withdraw`,
      withTokenForm(userToken, {}),
    );
    expect(confirm.status).toBe(200);
    const html = await confirm.text();
    expect(html).toContain("alice@example.test");
    expect(html).toContain("no available build");
    expect((await getById(deps.db, build.id))?.status).toBe("available"); // unchanged

    // With confirm: the build is withdrawn and the user is left no-build.
    const done = await adminWorker(access).request(
      `/admin/builds/${build.id}/withdraw`,
      withTokenForm(userToken, { confirm: "true" }),
    );
    expect(done.status).toBe(303);
    expect((await getById(deps.db, build.id))?.status).toBe("withdrawn");

    const xml = await (await appWorker().request(`/appcast?token=${token}`)).text();
    expect(xml).toContain("999000000"); // informational — no build to serve
    expect(xml).not.toContain("<enclosure");
  });
});
