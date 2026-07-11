import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getById } from "../../src/db/clients";
import { buildDeps } from "../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../support/access";
import { resetAll } from "../support/db";
import { seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-5 (§12.5) — Reissue. A new token replaces the old one; the installed app's old token now fails
// (informational re-activate notice), the new /get link works. The app self-heals, no reinstall.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

describe("CUJ-5 reissue", () => {
  it("confirms, then replaces the token: old stops resolving, new resolves normally", async () => {
    const { token: oldToken, client } = await seedServableClient(deps);
    const userToken = await access.signValidUser();

    // Reissue kills the tester's working token → the first POST is a confirmation, not a mutation.
    const confirm = await adminWorker(access).request(
      `/admin/clients/${client.id}/reissue`,
      withTokenForm(userToken, {}),
    );
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain(client.email);
    expect((await getById(deps.db, client.id))?.token).toBe(oldToken); // unchanged

    const res = await adminWorker(access).request(
      `/admin/clients/${client.id}/reissue`,
      withTokenForm(userToken, { confirm: "true" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/get?token="); // the new copy-paste link is shown

    const updated = await getById(deps.db, client.id);
    const newToken = updated?.token ?? "";
    expect(newToken).not.toBe(oldToken);

    const app = appWorker();
    expect(await (await app.request(`/appcast?token=${oldToken}`)).text()).toContain("999000000");
    expect(await (await app.request(`/appcast?token=${newToken}`)).text()).toContain("<enclosure");
  });
});
