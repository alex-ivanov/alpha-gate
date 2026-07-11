import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insert as insertClient } from "../../../src/db/clients";
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

// M21 — list filters, stats columns, and audit IP/Ray columns.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

async function getAdmin(path: string): Promise<string> {
  return (await adminWorker(access).request(path, withToken(await access.signValidUser()))).text();
}

describe("admin list filters + stats", () => {
  it("users list filters to no-available-build users", async () => {
    await seedServableClient(deps, { email: "servable@example.test" });
    await insertClient(deps.db, { email: "nobuild@example.test", token: "T".repeat(32) }); // no channel/build

    const all = await getAdmin("/admin/users");
    expect(all).toContain("servable@example.test");
    expect(all).toContain("nobuild@example.test");

    const filtered = await getAdmin("/admin/users?nobuild=1");
    expect(filtered).toContain("nobuild@example.test");
    expect(filtered).not.toContain("servable@example.test");
  });

  it("users list has the resolver verdict and last-seen columns", async () => {
    await seedServableClient(deps);
    const html = await getAdmin("/admin/users");
    expect(html).toContain("Next check"); // the resolver's answer, per user
    expect(html).toContain("Last seen");
  });

  it("activity log filters by event type", async () => {
    const { token } = await seedServableClient(deps);
    await appWorker().request(`/download?token=${token}&via=install`); // a 'download' event

    expect(await getAdmin("/admin/activity?event=download")).not.toContain("No activity matches");
    expect(await getAdmin("/admin/activity?event=update")).toContain("No activity matches");
  });

  it("audit log filters by action and shows IP / Ray ID columns", async () => {
    const { client } = await seedServableClient(deps);
    await adminWorker(access).request(
      `/admin/clients/${client.id}/revoke`,
      withTokenForm(await access.signValidUser(), { confirm: "true" }), // revoke is confirmed
    );

    const page = await getAdmin("/admin/audit");
    expect(page).toContain("Ray ID");
    expect(page).toContain("client.revoke");

    expect(await getAdmin("/admin/audit?action=client.revoke")).toContain("client.revoke");
    expect(await getAdmin("/admin/audit?action=build.withdraw")).toContain(
      "No admin actions match",
    );
  });
});
