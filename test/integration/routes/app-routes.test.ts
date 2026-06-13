import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildDeps } from "../../../src/deps";
import { putBranding } from "../../../src/r2/builds-bucket";
import { BRANDING_ICON_KEY } from "../../../src/r2/keys";
import { resetAll } from "../../support/db";
import { appWorker } from "../../support/worker";

const deps = buildDeps(env);
beforeEach(resetAll);

describe("app routes", () => {
  it("serves a known branding asset with an explicit type and nosniff", async () => {
    await putBranding(deps.r2, BRANDING_ICON_KEY, "PNG", "image/png");

    const res = await appWorker().request("/assets/icon");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("PNG");
  });

  it("404s an unknown asset name (no arbitrary R2 access)", async () => {
    expect((await appWorker().request("/assets/secrets")).status).toBe(404);
  });

  it("renders the public access page", async () => {
    const res = await appWorker().request("/access");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Request access");
  });

  it("404s /admin/* — the app worker has no admin surface", async () => {
    expect((await appWorker().request("/admin")).status).toBe(404);
    expect((await appWorker().request("/admin/clients")).status).toBe(404);
  });
});
