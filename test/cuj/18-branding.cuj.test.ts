import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { get as metaGet } from "../../src/db/meta";
import { buildDeps } from "../../src/deps";
import { getObject } from "../../src/r2/builds-bucket";
import { BRANDING_ICON_KEY } from "../../src/r2/keys";
import { adminWorker, setupTestAccess, type TestAccess } from "../support/access";
import { resetAll } from "../support/db";
import { seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-18 (§6/§13) — Branding. The admin sets the app name/accent + uploads an icon; the public /get
// page then renders them, and the icon is served from /assets/icon. Human-only.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

describe("CUJ-18 branding", () => {
  it("saves branding and renders it on the public page", async () => {
    const form = new FormData();
    form.set("app_name", "Acme");
    form.set("accent", "#FF5500");
    form.set("blurb", "Test the future");
    form.set("icon", new File(["PNGDATA"], "icon.png", { type: "image/png" }));

    const res = await adminWorker(access).request("/admin/branding", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await access.signValidUser() },
      body: form,
    });
    expect(res.status).toBe(303);

    expect(await metaGet(deps.db, "app_name")).toBe("Acme");
    expect(await (await getObject(deps.r2, BRANDING_ICON_KEY))?.text()).toBe("PNGDATA");

    const { token } = await seedServableClient(deps);
    const html = await (await appWorker().request(`/get?token=${token}`)).text();
    expect(html).toContain("Acme");
    expect(html).toContain("#FF5500");
    expect(html).toContain('src="/assets/icon"');
  });

  it("saves the activate URL scheme and the /get Activate link uses it (§7)", async () => {
    const form = new FormData();
    form.set("activate_scheme", "acme");
    const res = await adminWorker(access).request("/admin/branding", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await access.signValidUser() },
      body: form,
    });
    expect(res.status).toBe(303);
    expect(await metaGet(deps.db, "activate_scheme")).toBe("acme");

    const { token } = await seedServableClient(deps);
    const html = await (await appWorker().request(`/get?token=${token}`)).text();
    expect(html).toContain(`acme://activate?token=${token}`);
    expect(html).not.toContain("myapp://");
  });

  it("defaults the activate scheme to myapp when none is configured", async () => {
    const { token } = await seedServableClient(deps);
    const html = await (await appWorker().request(`/get?token=${token}`)).text();
    expect(html).toContain(`myapp://activate?token=${token}`);
  });

  it("refuses a service token (branding is human-only)", async () => {
    const form = new FormData();
    form.set("app_name", "Hacked");
    const res = await adminWorker(access).request("/admin/branding", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await access.signValidService() },
      body: form,
    });
    expect(res.status).toBe(403);
    expect(await metaGet(deps.db, "app_name")).toBeNull();
  });

  it("rejects an unsupported icon type", async () => {
    const form = new FormData();
    form.set("icon", new File(["x"], "evil.html", { type: "text/html" }));
    const res = await adminWorker(access).request("/admin/branding", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await access.signValidUser() },
      body: form,
    });
    expect(res.status).toBe(400);
  });
});
