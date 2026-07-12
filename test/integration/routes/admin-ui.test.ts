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
  it("users page has the labeled add-user form and rows that open the user page", async () => {
    await seedServableClient(deps, { email: "alice@example.test" });
    const html = await getAdmin("/admin/users");
    expect(html).toContain('action="/admin/clients"'); // add-user form
    expect(html).toContain('name="email"');
    expect(html).toContain("<span>Email</span>"); // real labels, not placeholder-only
    expect(html).toContain("/admin/users/"); // the row links to the user page (actions live there)
    expect(html).toContain("Next check"); // the resolver column
    expect(html).not.toContain("/revoke"); // no destructive one-click buttons on list rows
  });

  it("list tables ship the sortable-table contract and the enhancer script", async () => {
    await seedServableClient(deps, { email: "alice@example.test" });
    const html = await getAdmin("/admin/users");
    expect(html).toContain("<table data-enhance="); // table opts into the enhancer
    expect(html).toContain('data-sort="text"'); // a text-sortable header (Email/Status/…)
    expect(html).toContain('data-sort="num"'); // a numeric-sortable header (Installed/Pinned)
    expect(html).toContain("table[data-enhance]"); // the injected enhancer script is on the page
    // The Next-check column stays unsortable — no data-sort on its header (it's a composite verdict).
    expect(html).toMatch(/<th>Next check<\/th>/);
  });

  it("user manage page renders the unassign/pin/access forms", async () => {
    const { client } = await seedServableClient(deps);
    const html = await getAdmin(`/admin/users/${client.id}`);
    expect(html).toContain("/streams/unassign"); // already assigned to "stable"
    expect(html).toContain("/pin");
    expect(html).toContain("/reissue");
  });

  it("builds page has build-page links, the bulk bar, and canonical filter values", async () => {
    await seedServableClient(deps, { buildNumber: 1500 });
    const html = await getAdmin("/admin/builds");
    expect(html).toContain("/admin/builds/"); // the row links to the build page (actions live there)
    expect(html).toContain('action="/admin/builds/bulk"'); // bulk form
    expect(html).toContain('name="id"'); // selection checkboxes
    expect(html).toContain("data-check-all"); // select-all header checkbox (progressive enhancement)
    expect(html).toContain('value="withdraw"'); // bulk op button
    // Client-side filter controls target columns by their header key; the critical cell carries a
    // canonical data-value so the checkbox filter matches "yes", not the tag it displays.
    expect(html).toContain('data-filter-col="state"');
    expect(html).toContain('data-filter-col="crit"');
    expect(html).toContain('data-filter-col="channels"');
    expect(html).toMatch(/data-key="crit"/);
    expect(html).toMatch(/<td data-value="(yes|no)">/);
  });

  it("build manage page shows the EdDSA signature, size, and the rollback toggle", async () => {
    const { build } = await seedServableClient(deps, { buildNumber: 1500 });
    const html = await getAdmin(`/admin/builds/${build.id}`);
    expect(html).toContain("ed-sig"); // the EdDSA signature value
    expect(html).toContain("EdDSA signature");
    expect(html).toContain("bytes"); // exact byte count rides in the title attribute
    expect(html).toContain(`/admin/builds/${build.id}/rollback`); // rollback toggle form
    expect(html).toContain("rollback target"); // designate label
  });

  it("upload page renders a multipart upload form to the upload endpoint", async () => {
    const html = await getAdmin("/admin/upload");
    expect(html).toContain('action="/admin/builds/upload"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('name="ed_signature"');
    // Version/build autofill from the picked archive: the form opts in and the extractor script ships.
    expect(html).toContain("data-archive-autofill");
    expect(html).toContain("locateInfoPlist");
    expect(html).toContain("data-autofill-status"); // visible success/failure feedback element
    expect(html).toContain("Info.plist"); // the hint tells you to pick the signed .app .zip
    // Two modes: a Normal release / Rollback toggle, with the §9 roll-forward guidance in the rollback block.
    expect(html).toContain('id="mode-normal"');
    expect(html).toContain('id="mode-rollback"');
    expect(html).toContain("roll-forward");
    expect(html).toContain("rollback-only");
    // No-channel hint so a build published to no channel isn't a silent dead end.
    expect(html).toContain("offered to no one");
  });

  it("flags a user with no channel (and no pin) as receiving no updates", async () => {
    await adminWorker(access).request(
      "/admin/clients",
      withTokenForm(await access.signValidUser(), { email: "lonely@example.test" }),
    );
    const html = await getAdmin("/admin/users");
    expect(html).toContain("no channel"); // the warn badge in the Channels column
    expect(html).toContain("receives no updates"); // the add-user tip
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

  it("settings page reports email as copy-paste and shows how to enable real delivery", async () => {
    // The test env runs EMAIL_PROVIDER=none → copy-paste; the panel must say so AND show the deploy
    // command (scoped to this instance) so the admin isn't left guessing how to turn email on.
    const html = await getAdmin("/admin/settings");
    expect(html).toContain("copy-paste links (no email sent)");
    expect(html).toContain("Set up email delivery");
    expect(html).toContain("--email-provider cloudflare");
    expect(html).toContain("--instance test"); // command scoped to this instance
  });

  it("CI page documents the service-token publish flow for this instance", async () => {
    const html = await getAdmin("/admin/ci");
    expect(html).toContain("CF_ACCESS_CLIENT_ID");
    expect(html).toContain("/admin/builds/register");
    expect(html).toContain("publish.sh");
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

  it("channels page has the add-channel form, a serving column, and channel-page links", async () => {
    await createStream(deps.db, "stable"); // so a row renders
    const html = await getAdmin("/admin/streams");
    expect(html).toContain('action="/admin/streams"');
    expect(html).toContain("Serving"); // what each channel offers, on the list itself
    const stable = await getByName(deps.db, "stable");
    expect(html).toContain(`/admin/streams/${stable?.id}`); // the row links to the channel page
  });

  it("re-creating an existing channel name is a clear 409, not a 500", async () => {
    await createStream(deps.db, "stable");
    const res = await adminWorker(access).request(
      "/admin/streams",
      withTokenForm(await access.signValidUser(), { name: "stable" }),
    );
    expect(res.status).toBe(409); // not the DB UNIQUE-constraint's bare 500
    expect(await res.text()).toContain("Channel already exists");
    expect((await listStreams(deps.db)).length).toBe(1); // no duplicate row
  });

  it("channel manage page renders link/assign controls and what it currently serves", async () => {
    await seedServableClient(deps); // channel "stable" with a linked build + assigned, servable user
    const stable = await getByName(deps.db, "stable");
    const html = await getAdmin(`/admin/streams/${stable?.id}`);
    expect(html).toContain("Serving"); // the verdict strip names the served build
    expect(html).toContain("/streams/unlink"); // the linked build can be unlinked
    expect(html).toContain("/streams/unassign"); // the assigned user can be unassigned
    expect(html).toContain(`/admin/streams/${stable?.id}/delete`); // delete lives in the danger zone
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
