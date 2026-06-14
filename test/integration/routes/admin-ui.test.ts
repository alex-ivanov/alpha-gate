import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { create as createStream, getByName, list as listStreams } from "../../../src/db/streams";
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

// M19 — the admin operation UI: every page renders forms/buttons that POST to the (tested) handlers,
// and channels can be created/deleted from the browser.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

async function getAdmin(path: string): Promise<string> {
  return (await adminWorker(access).request(path, withToken(await access.signValidUser()))).text();
}

describe("admin operation pages", () => {
  it("users page has the add-user form and per-row actions", async () => {
    await seedServableClient(deps, { email: "alice@example.test" });
    const html = await getAdmin("/admin/users");
    expect(html).toContain('action="/admin/clients"'); // add-user form
    expect(html).toContain('name="email"');
    expect(html).toContain("/revoke");
    expect(html).toContain("/reissue");
    expect(html).toContain("/admin/users/"); // Manage link
  });

  it("user manage page renders the unassign/pin/access forms", async () => {
    const { client } = await seedServableClient(deps);
    const html = await getAdmin(`/admin/users/${client.id}`);
    expect(html).toContain("/streams/unassign"); // already assigned to "stable"
    expect(html).toContain("/pin");
    expect(html).toContain("/reissue");
  });

  it("builds page has withdraw/critical actions and a manage link", async () => {
    await seedServableClient(deps, { buildNumber: 1500 });
    const html = await getAdmin("/admin/builds");
    expect(html).toContain("/withdraw");
    expect(html).toContain("/critical");
    expect(html).toContain("/admin/builds/");
  });

  it("upload page renders a multipart upload form to the upload endpoint", async () => {
    const html = await getAdmin("/admin/upload");
    expect(html).toContain('action="/admin/builds/upload"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('name="ed_signature"');
  });

  it("settings page renders the branding form", async () => {
    const html = await getAdmin("/admin/settings");
    expect(html).toContain('action="/admin/branding"');
    expect(html).toContain('name="app_name"');
    expect(html).toContain('name="invite_body"');
  });

  it("channels page has the add-channel form and a delete action", async () => {
    await createStream(deps.db, "stable"); // so a row (and its delete button) renders
    const html = await getAdmin("/admin/streams");
    expect(html).toContain('action="/admin/streams"');
    expect(html).toContain("/delete");
  });
});

describe("channel endpoints", () => {
  it("creates a channel", async () => {
    const res = await adminWorker(access).request(
      "/admin/streams",
      withTokenForm(await access.signValidUser(), { name: "beta" }),
    );
    expect(res.status).toBe(303);
    expect((await listStreams(deps.db)).map((s) => s.name)).toContain("beta");
  });

  it("deleting a channel that strands users is confirmed, then proceeds", async () => {
    await seedServableClient(deps); // creates channel "stable" with an assigned, servable user
    const stable = await getByName(deps.db, "stable");
    const id = stable?.id ?? 0;
    const userToken = await access.signValidUser();

    const confirm = await adminWorker(access).request(
      `/admin/streams/${id}/delete`,
      withTokenForm(userToken, {}),
    );
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain("no available build");
    expect(await listStreams(deps.db)).toHaveLength(1); // not deleted

    const done = await adminWorker(access).request(
      `/admin/streams/${id}/delete`,
      withTokenForm(userToken, { confirm: "true" }),
    );
    expect(done.status).toBe(303);
    expect(await listStreams(deps.db)).toHaveLength(0);
  });
});
