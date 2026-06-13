import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../src/db/admin-audit";
import { getById } from "../../src/db/clients";
import { buildDeps } from "../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../support/access";
import { resetAll } from "../support/db";
import { seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-4 (§12.6) — Revoke. Admin revokes → status=revoked + an audit row → /appcast returns the
// informational notice and /download is denied. A service token may not revoke (decision 0006).
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

describe("CUJ-4 revoke", () => {
  it("cuts off access and records an audit row", async () => {
    const { token, client } = await seedServableClient(deps);

    const res = await adminWorker(access).request(
      `/admin/clients/${client.id}/revoke`,
      withTokenForm(await access.signValidUser(), {}),
    );
    expect(res.status).toBe(303);

    expect((await getById(deps.db, client.id))?.status).toBe("revoked");
    expect((await listInOrder(deps.db)).some((r) => r.action === "client.revoke")).toBe(true);

    const app = appWorker();
    const xml = await (await app.request(`/appcast?token=${token}`)).text();
    expect(xml).toContain("999000000"); // informational, no enclosure
    expect(xml).not.toContain("<enclosure");
    expect((await app.request(`/download?token=${token}&via=install`)).status).toBe(404);
  });

  it("refuses a service token (only a human may revoke)", async () => {
    const { client } = await seedServableClient(deps);
    const res = await adminWorker(access).request(
      `/admin/clients/${client.id}/revoke`,
      withTokenForm(await access.signValidService(), {}),
    );
    expect(res.status).toBe(403);
  });
});
