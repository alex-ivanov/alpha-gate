import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as meta from "../../../src/db/meta";
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
  // Pass `env` as the third arg so c.env carries the [vars] (the Settings info panel reads them),
  // exactly as the deployed Worker is invoked.
  return (
    await adminWorker(access).request(path, withToken(await access.signValidUser()), env)
  ).text();
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

  it("builds page has withdraw/critical actions, a manage link, and the bulk bar", async () => {
    await seedServableClient(deps, { buildNumber: 1500 });
    const html = await getAdmin("/admin/builds");
    expect(html).toContain("/withdraw");
    expect(html).toContain("/critical");
    expect(html).toContain("/admin/builds/");
    expect(html).toContain('action="/admin/builds/bulk"'); // bulk form
    expect(html).toContain('name="id"'); // selection checkboxes
    expect(html).toContain('value="withdraw"'); // bulk op button
    expect(html).toContain("Rollback"); // rollback column header
  });

  it("build manage page shows the EdDSA signature, length, and the rollback toggle", async () => {
    const { build } = await seedServableClient(deps, { buildNumber: 1500 });
    const html = await getAdmin(`/admin/builds/${build.id}`);
    expect(html).toContain("ed-sig"); // the EdDSA signature value
    expect(html).toContain("Enclosure length");
    expect(html).toContain(`/admin/builds/${build.id}/rollback`); // rollback toggle form
    expect(html).toContain("rollback target"); // designate label
  });

  it("upload page renders a multipart upload form to the upload endpoint", async () => {
    const html = await getAdmin("/admin/upload");
    expect(html).toContain('action="/admin/builds/upload"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('name="ed_signature"');
  });

  it("settings page renders the branding form, header upload, and the instance info panel", async () => {
    const html = await getAdmin("/admin/settings");
    expect(html).toContain('action="/admin/branding"');
    expect(html).toContain('name="app_name"');
    expect(html).toContain('name="header"'); // branding header image upload
    expect(html).toContain('name="activate_scheme"'); // §7 deep-link scheme
    expect(html).toContain('name="invite_body"');
    expect(html).toContain("This instance"); // info panel
    expect(html).toContain("0.0.0-test"); // TOOL_VERSION from the test env
    expect(html).toContain("Self-update");
  });

  it("CI page documents the service-token publish flow for this instance", async () => {
    const html = await getAdmin("/admin/ci");
    expect(html).toContain("CF_ACCESS_CLIENT_ID");
    expect(html).toContain("/admin/builds/register");
    expect(html).toContain("ci-publish.sh");
  });

  it("settings page has the Sparkle public-key field", async () => {
    const html = await getAdmin("/admin/settings");
    expect(html).toContain('name="sparkle_public_key"');
  });

  it("setup page renders the personalized app-wiring guide", async () => {
    await meta.set(deps.db, "activate_scheme", "acme");
    await meta.set(deps.db, "sparkle_public_key", "TESTPUBKEY==");
    const html = await getAdmin("/admin/setup");
    expect(html).toContain("SUPublicEDKey");
    expect(html).toContain("TESTPUBKEY=="); // the saved key, filled into the Info.plist snippet
    expect(html).toContain("acme://activate?token="); // the configured scheme
    expect(html).toContain("/appcast?token="); // the per-user feed URL
  });

  it("setup page warns when no Sparkle public key is saved", async () => {
    const html = await getAdmin("/admin/setup");
    expect(html).toContain("No Sparkle public key saved yet");
  });

  it("channels page has the add-channel form, a manage link, and a delete action", async () => {
    await createStream(deps.db, "stable"); // so a row (and its action buttons) renders
    const html = await getAdmin("/admin/streams");
    expect(html).toContain('action="/admin/streams"');
    expect(html).toContain("/delete");
    const stable = await getByName(deps.db, "stable");
    expect(html).toContain(`/admin/streams/${stable?.id}`); // Manage link
  });

  it("channel manage page renders link/assign controls and what it currently serves", async () => {
    await seedServableClient(deps); // channel "stable" with a linked build + assigned, servable user
    const stable = await getByName(deps.db, "stable");
    const html = await getAdmin(`/admin/streams/${stable?.id}`);
    expect(html).toContain("Currently serving");
    expect(html).toContain("/streams/unlink"); // the linked build can be unlinked
    expect(html).toContain("/streams/unassign"); // the assigned user can be unassigned
    expect(html).toContain(`/admin/streams/${stable?.id}/delete`);
  });

  it("channel manage page 404s for an unknown channel", async () => {
    const res = await adminWorker(access).request(
      "/admin/streams/99999",
      withToken(await access.signValidUser()),
    );
    expect(res.status).toBe(404);
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
