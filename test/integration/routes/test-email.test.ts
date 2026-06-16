import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../../src/db/admin-audit";
import { buildDeps } from "../../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../../support/access";
import { resetAll } from "../../support/db";

// The §13 "Send test email" debug action: reproduce delivery from Settings without creating a user,
// and surface the provider's exact error (also logged for `wrangler tail`).
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

// An env where email reads as "active" (provider + binding + From), so the handler attempts a real send.
const activeEnv = {
  ...env,
  EMAIL_PROVIDER: "cloudflare",
  EMAIL_FROM: "alpha@example.test",
  EMAIL: {},
} as typeof env;

describe("send test email", () => {
  it("refuses (400) when email isn't configured — nothing to test", async () => {
    const res = await adminWorker(access).request(
      "/admin/settings/test-email",
      withTokenForm(await access.signValidUser(), {}),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Email not configured");
  });

  it("sends to the admin's own address by default and reports success + audits", async () => {
    const sent: { to: string }[] = [];
    const okEmail = { send: async (m: { to: string }) => void sent.push(m) };
    const res = await adminWorker(access, { email: okEmail }).request(
      "/admin/settings/test-email",
      withTokenForm(await access.signValidUser("me@example.test"), {}),
      activeEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Test email sent");
    expect(sent[0]?.to).toBe("me@example.test"); // defaulted to the signed-in admin
    expect((await listInOrder(deps.db)).some((r) => r.action === "email.test")).toBe(true);
  });

  it("surfaces the provider error (502) when the send fails", async () => {
    const failEmail = {
      send: async () => {
        throw new Error("domain not onboarded for sending");
      },
    };
    const res = await adminWorker(access, { email: failEmail }).request(
      "/admin/settings/test-email",
      withTokenForm(await access.signValidUser(), { to: "x@example.test" }),
      activeEnv,
    );
    expect(res.status).toBe(502);
    const html = await res.text();
    expect(html).toContain("Test email failed");
    expect(html).toContain("domain not onboarded for sending"); // the exact provider reason
  });
});
