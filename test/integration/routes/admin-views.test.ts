import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildDeps } from "../../../src/deps";
import { recordAudit } from "../../../src/services/audit";
import { adminWorker, setupTestAccess, type TestAccess, withToken } from "../../support/access";
import { resetAll } from "../../support/db";
import { seedServableClient } from "../../support/scenario";

// §13 — the read-only back office renders the seeded data (behind the auth middleware).
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

async function getAdmin(path: string): Promise<Response> {
  return adminWorker(access).request(path, withToken(await access.signValidUser()));
}

describe("admin read views", () => {
  it("dashboard shows counts", async () => {
    await seedServableClient(deps);
    const html = await (await getAdmin("/admin")).text();
    expect(html).toContain("users");
    expect(html).toContain("channels");
  });

  it("users list shows the seeded client and its servable state", async () => {
    await seedServableClient(deps, { email: "alice@example.test" });
    const html = await (await getAdmin("/admin/users")).text();
    expect(html).toContain("alice@example.test");
    expect(html).toContain("ok"); // servable badge
  });

  it("users list flags a no-build user (withdrawn-only build, stranded)", async () => {
    const { build } = await seedServableClient(deps, { email: "bob@example.test" });
    // withdraw the only build, and record an installed build so the state is "stranded"
    await deps.db
      .prepare("UPDATE builds SET status = 'withdrawn' WHERE id = ?")
      .bind(build.id)
      .run();
    const html = await (await getAdmin("/admin/users")).text();
    expect(html).toContain("bob@example.test");
    expect(html).toContain("badge warn");
  });

  it("builds list shows the build and its channel", async () => {
    await seedServableClient(deps, { buildNumber: 1500 });
    const html = await (await getAdmin("/admin/builds")).text();
    expect(html).toContain("1500");
    expect(html).toContain("stable");
  });

  it("audit log renders recorded admin actions", async () => {
    await recordAudit(deps, {
      actorEmail: "admin@example.test",
      action: "client.revoke",
      target: "x@y",
      detail: null,
      ip: null,
      rayId: null,
      createdAt: "2026-06-13T00:00:00Z",
    });
    const html = await (await getAdmin("/admin/audit")).text();
    expect(html).toContain("client.revoke");
    expect(html).toContain("admin@example.test");
  });

  it("still fails closed without a token", async () => {
    expect((await adminWorker(access).request("/admin/users")).status).toBe(403);
  });
});
