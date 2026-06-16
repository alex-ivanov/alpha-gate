import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../../src/db/admin-audit";
import * as builds from "../../../src/db/builds";
import * as clients from "../../../src/db/clients";
import { buildDeps } from "../../../src/deps";
import {
  adminWorker,
  setupTestAccess,
  type TestAccess,
  withToken,
  withTokenForm,
} from "../../support/access";
import { resetAll } from "../../support/db";
import { seedServableClient } from "../../support/scenario";
import { appWorker } from "../../support/worker";

// Hide/unhide is admin-list declutter only — it must keep items out of the default lists while never
// changing what resolves or serves (revoke/withdraw remain the functional controls).
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

const userToken = () => access.signValidUser();
async function getAdmin(path: string): Promise<string> {
  return (await adminWorker(access).request(path, withToken(await userToken()))).text();
}

describe("hide / unhide users", () => {
  it("hidden users drop out of the default list but return with ?hidden=1, and it audits", async () => {
    const client = await clients.insert(deps.db, {
      email: "clutter@example.test",
      token: "T".repeat(32),
    });

    const res = await adminWorker(access).request(
      `/admin/clients/${client.id}/hidden`,
      withTokenForm(await userToken(), { hidden: "true" }),
    );
    expect(res.status).toBe(303);
    expect((await clients.getById(deps.db, client.id))?.hidden).toBe(true);

    expect(await getAdmin("/admin/users")).not.toContain("clutter@example.test");
    expect(await getAdmin("/admin/users?hidden=1")).toContain("clutter@example.test");
    expect((await listInOrder(deps.db)).some((r) => r.action === "client.hide")).toBe(true);

    const unhide = await adminWorker(access).request(
      `/admin/clients/${client.id}/hidden`,
      withTokenForm(await userToken(), { hidden: "false" }),
    );
    expect(unhide.status).toBe(303);
    expect((await clients.getById(deps.db, client.id))?.hidden).toBe(false);
    expect(await getAdmin("/admin/users")).toContain("clutter@example.test");
    expect((await listInOrder(deps.db)).some((r) => r.action === "client.unhide")).toBe(true);
  });

  it("hiding a user never changes whether they can download (declutter only)", async () => {
    const { token, client } = await seedServableClient(deps, { email: "served@example.test" });

    await adminWorker(access).request(
      `/admin/clients/${client.id}/hidden`,
      withTokenForm(await userToken(), { hidden: "true" }),
    );

    const dl = await appWorker().request(`/download?token=${token}&via=install`);
    expect(dl.status).toBe(200); // hidden but still fully served
  });
});

describe("hide / unhide builds", () => {
  async function aBuild(buildNumber: number) {
    return builds.insert(deps.db, {
      shortVersion: `1.0.${buildNumber}`,
      buildNumber,
      objectKey: `build/${buildNumber}/App.zip`,
      edSignature: "s",
      length: 1,
    });
  }

  it("hidden builds drop out of the default list but return with ?hidden=1, and it audits", async () => {
    const build = await aBuild(1700);

    const res = await adminWorker(access).request(
      `/admin/builds/${build.id}/hidden`,
      withTokenForm(await userToken(), { hidden: "true" }),
    );
    expect(res.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.hidden).toBe(true);

    const visible = await getAdmin("/admin/builds");
    expect(visible).not.toContain("1.0.1700");
    expect(await getAdmin("/admin/builds?hidden=1")).toContain("1.0.1700");
    expect((await listInOrder(deps.db)).some((r) => r.action === "build.hide")).toBe(true);

    const unhide = await adminWorker(access).request(
      `/admin/builds/${build.id}/hidden`,
      withTokenForm(await userToken(), { hidden: "false" }),
    );
    expect(unhide.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.hidden).toBe(false);
    expect(await getAdmin("/admin/builds")).toContain("1.0.1700");
    expect((await listInOrder(deps.db)).some((r) => r.action === "build.unhide")).toBe(true);
  });
});
