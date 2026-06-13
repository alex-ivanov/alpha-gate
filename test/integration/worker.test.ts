import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/worker";

// §17 — the single role-switched entrypoint. fetch dispatches by ROLE; each role 404s the other's
// surface, and the admin surface is fail-closed when Access isn't configured (the test env).

async function fetchAs(role: "app" | "admin", path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://x${path}`), { ...env, ROLE: role }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("worker entrypoint", () => {
  it("ROLE=app serves the public surface and 404s /admin", async () => {
    expect((await fetchAs("app", "/get?token=bad")).status).toBe(404); // unknown token → generic 404
    expect((await fetchAs("app", "/admin")).status).toBe(404);
  });

  it("ROLE=admin fails closed without an Access assertion", async () => {
    // adminAuth runs on every path first, so any admin request without a valid token is 403.
    expect((await fetchAs("admin", "/admin")).status).toBe(403);
  });
});
