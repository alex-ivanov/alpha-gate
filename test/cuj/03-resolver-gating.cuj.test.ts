import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { generateToken } from "../../src/core/tokens";
import { buildDeps } from "../../src/deps";
import { resetAll } from "../support/db";
import { appWorker } from "../support/worker";

// CUJ-3 (§3/§6) — the gate. An unknown token reveals nothing: /get returns a generic 404 (not the
// landing page) and /download is denied with no event logged. (The /appcast informational half is in
// M10.) A revoked token behaves the same on these two routes.
const deps = buildDeps(env);
beforeEach(resetAll);

async function accessLogCount(): Promise<number> {
  const row = await deps.db.prepare("SELECT COUNT(*) AS n FROM access_log").first<{ n: number }>();
  return row?.n ?? 0;
}

describe("CUJ-3 resolver gating (get + download)", () => {
  it("an unknown token gets a generic 404 from /get, never the landing page", async () => {
    const res = await appWorker().request(`/get?token=${generateToken()}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Download");
  });

  it("an unknown token is denied at /download and logs nothing", async () => {
    const res = await appWorker().request(`/download?token=${generateToken()}&via=install`);
    expect(res.status).toBe(404);
    expect(await accessLogCount()).toBe(0);
  });

  it("a malformed token is treated identically (no existence signal)", async () => {
    const res = await appWorker().request("/get?token=not-a-token");
    expect(res.status).toBe(404);
  });
});
