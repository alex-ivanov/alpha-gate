import { beforeAll, describe, expect, it } from "vitest";
import {
  adminWorker,
  setupTestAccess,
  TEST_NOW,
  type TestAccess,
  withToken,
} from "../support/access";

// CUJ-12 (§12, §4) — admin authentication. Every admin request is gated by one middleware mount;
// missing/expired/wrong-audience tokens fail closed; a valid human OR service token is admitted.
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});

describe("CUJ-12 admin auth", () => {
  it("rejects a request with no Access assertion (fail closed)", async () => {
    const res = await adminWorker(access).request("/admin");
    expect(res.status).toBe(403);
  });

  it("admits a valid human admin token", async () => {
    const res = await adminWorker(access).request(
      "/admin",
      withToken(await access.signValidUser()),
    );
    expect(res.status).toBe(200);
  });

  it("scopes a valid service token to the publish surface (decision 0006)", async () => {
    const service = await access.signValidService();
    // Authenticated but NOT admitted to the back office (reads include live invite links).
    const read = await adminWorker(access).request("/admin", withToken(service));
    expect(read.status).toBe(403);
    // The publish surface still accepts it — a bad POST gets a 4xx VALIDATION error, not the
    // 403 scope rejection (proving the token passed both auth and the scope gate).
    const publish = await adminWorker(access).request("/admin/builds/upload", {
      ...withToken(service),
      method: "POST",
    });
    expect(publish.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const token = await access.sign(access.validUserClaims({ exp: TEST_NOW - 4000 }));
    expect((await adminWorker(access).request("/admin", withToken(token))).status).toBe(403);
  });

  it("rejects a wrong-audience token", async () => {
    const token = await access.sign(access.validUserClaims({ aud: "other" }));
    expect((await adminWorker(access).request("/admin", withToken(token))).status).toBe(403);
  });

  it("404s a public route on the admin worker (ROLE separation)", async () => {
    const res = await adminWorker(access).request(
      "/get?token=x",
      withToken(await access.signValidUser()),
    );
    expect(res.status).toBe(404);
  });
});
