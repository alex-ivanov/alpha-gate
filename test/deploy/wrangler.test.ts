import { describe, expect, it, vi } from "vitest";
import { createFakeWrangler, createWrangler } from "../../src/deploy/seams/wrangler";

// The real run() shells out to wrangler (real-infra, not unit-tested). We pin the dry-run behavior and
// the programmable fake the orchestration tests rely on.

describe("createWrangler dry-run", () => {
  it("logs the intended command and no-ops with success", async () => {
    const log = vi.fn();
    const w = createWrangler({ dryRun: true, log });
    const r = await w.run(["d1", "create", "alpha-gate-x"]);
    expect(r).toMatchObject({ ok: true, code: 0 });
    expect(log).toHaveBeenCalledWith("[dry-run] wrangler d1 create alpha-gate-x");
  });
});

describe("createFakeWrangler", () => {
  it("records calls and returns success by default", async () => {
    const w = createFakeWrangler();
    await w.run(["whoami"]);
    await w.run(["d1", "list", "--json"]);
    expect(w.calls).toEqual([["whoami"], ["d1", "list", "--json"]]);
    expect((await w.run(["x"])).ok).toBe(true);
  });

  it("lets the handler script per-command output and failure", async () => {
    const w = createFakeWrangler((args) => {
      if (args[0] === "d1" && args[1] === "list") return { stdout: '[{"name":"x","uuid":"u"}]' };
      if (args[0] === "r2") return { ok: false, code: 1, stderr: "not found" };
      return {};
    });
    expect((await w.run(["d1", "list", "--json"])).stdout).toContain("uuid");
    const r2 = await w.run(["r2", "bucket", "info", "x"]);
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe(1);
  });
});
