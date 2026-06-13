import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../../src/db/admin-audit";
import * as builds from "../../../src/db/builds";
import * as clients from "../../../src/db/clients";
import { buildDeps } from "../../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../../support/access";
import { resetAll } from "../../support/db";

// Route-level coverage for the review fixes: createClient email validation, and the unpin §11 gate.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

const userToken = () => access.signValidUser();

describe("createClient", () => {
  it("creates a client, surfaces the /get link, and audits", async () => {
    const res = await adminWorker(access).request(
      "/admin/clients",
      withTokenForm(await userToken(), { email: "new@example.test" }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/get?token=");
    expect((await clients.list(deps.db)).map((c) => c.email)).toContain("new@example.test");
    expect((await listInOrder(deps.db)).some((r) => r.action === "client.create")).toBe(true);
  });

  it("rejects a malformed email with 400 and creates nothing", async () => {
    const res = await adminWorker(access).request(
      "/admin/clients",
      withTokenForm(await userToken(), { email: "notanemail" }),
    );
    expect(res.status).toBe(400);
    expect(await clients.list(deps.db)).toHaveLength(0);
  });
});

describe("unpinClient §11 confirmation", () => {
  it("requires confirmation when unpinning would strand the user", async () => {
    const client = await clients.insert(deps.db, {
      email: "pinned@example.test",
      token: "T".repeat(32),
    });
    // Pinned to an available build, but assigned to no stream → unpin leaves no servable target.
    const build = await builds.insert(deps.db, {
      shortVersion: "1.4.0",
      buildNumber: 1500,
      objectKey: "build/1500/App.zip",
      edSignature: "s",
      length: 1,
    });
    await clients.setPinnedBuild(deps.db, client.id, build.id);

    const confirm = await adminWorker(access).request(
      `/admin/clients/${client.id}/unpin`,
      withTokenForm(await userToken(), {}),
    );
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain("pinned@example.test");
    expect((await clients.getById(deps.db, client.id))?.pinnedBuildId).toBe(build.id); // unchanged

    const done = await adminWorker(access).request(
      `/admin/clients/${client.id}/unpin`,
      withTokenForm(await userToken(), { confirm: "true" }),
    );
    expect(done.status).toBe(303);
    expect((await clients.getById(deps.db, client.id))?.pinnedBuildId).toBeNull();
  });
});
