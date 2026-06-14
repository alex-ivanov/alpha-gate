import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countPending, listByStatus } from "../../../src/db/access-requests";
import {
  findByEmail,
  insert as insertClient,
  list as listClients,
  setStatus,
} from "../../../src/db/clients";
import { buildDeps } from "../../../src/deps";
import {
  adminWorker,
  setupTestAccess,
  type TestAccess,
  withToken,
  withTokenForm,
} from "../../support/access";
import { resetAll } from "../../support/db";
import { appWorker } from "../../support/worker";

// M20 — pending access requests, end to end: the public form submits → admin reviews → invite/dismiss.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

async function firstPendingId(): Promise<number> {
  const requests = await listByStatus(deps.db);
  return requests[0]?.id ?? 0;
}

describe("public request-access submission", () => {
  it("stores a pending request for a valid email", async () => {
    const res = await appWorker().request("/access", form({ email: "want@example.test" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Request received");
    expect((await listByStatus(deps.db)).map((r) => r.email)).toEqual(["want@example.test"]);
  });

  it("rejects a malformed email and stores nothing", async () => {
    const res = await appWorker().request("/access", form({ email: "nope" }));
    expect(res.status).toBe(400);
    expect(await countPending(deps.db)).toBe(0);
  });
});

describe("admin pending requests", () => {
  const userToken = () => access.signValidUser();

  it("lists pending requests, and the dashboard shows the count", async () => {
    await appWorker().request("/access", form({ email: "a@example.test" }));

    const pending = await (
      await adminWorker(access).request("/admin/pending", withToken(await userToken()))
    ).text();
    expect(pending).toContain("a@example.test");

    const dash = await (
      await adminWorker(access).request("/admin", withToken(await userToken()))
    ).text();
    expect(dash).toContain("pending requests");
  });

  it("invite creates a client, marks the request handled, and shows the /get link", async () => {
    await appWorker().request("/access", form({ email: "new@example.test" }));

    const res = await adminWorker(access).request(
      `/admin/pending/${await firstPendingId()}/invite`,
      withTokenForm(await userToken(), {}),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/get?token=");
    expect(await findByEmail(deps.db, "new@example.test")).not.toBeNull();
    expect(await countPending(deps.db)).toBe(0);
  });

  it("invite re-issues AND re-activates a revoked client (the revoked-user re-access path, §12)", async () => {
    const created = await insertClient(deps.db, {
      email: "back@example.test",
      token: "OLD00000000000000000000000000001",
    });
    await setStatus(deps.db, created.id, "revoked"); // they were revoked; now they re-request access
    await appWorker().request("/access", form({ email: "back@example.test" }));

    await adminWorker(access).request(
      `/admin/pending/${await firstPendingId()}/invite`,
      withTokenForm(await userToken(), {}),
    );

    const back = await findByEmail(deps.db, "back@example.test");
    expect(
      (await listClients(deps.db)).filter((c) => c.email === "back@example.test"),
    ).toHaveLength(1); // re-grant, not a duplicate row
    expect(back?.token).not.toBe("OLD00000000000000000000000000001"); // fresh token
    expect(back?.status).toBe("active"); // re-activated — the new /get link is live, not dead on arrival
  });

  it("dismiss marks the request dismissed", async () => {
    await appWorker().request("/access", form({ email: "x@example.test" }));

    const res = await adminWorker(access).request(
      `/admin/pending/${await firstPendingId()}/dismiss`,
      withTokenForm(await userToken(), {}),
    );
    expect(res.status).toBe(303);
    expect(await countPending(deps.db)).toBe(0);
  });
});
