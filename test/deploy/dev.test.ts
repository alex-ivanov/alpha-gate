import { describe, expect, it } from "vitest";
import { type DevEnv, runDev } from "../../src/deploy/commands/dev";
import { plainPalette } from "../../src/deploy/core/colors";
import { createFakeFileSystem, type FileSystem } from "../../src/deploy/seams/files";
import { createFakeWrangler, type Wrangler } from "../../src/deploy/seams/wrangler";

function makeEnv(w: Wrangler): { env: DevEnv; out: string[]; fs: FileSystem } {
  const out: string[] = [];
  const fs = createFakeFileSystem();
  return {
    out,
    fs,
    env: {
      wrangler: w,
      fs,
      palette: plainPalette,
      out: (line) => out.push(line),
      rootDir: "/pkg",
      stateDir: "/state",
      toolVersion: "0.1.0",
      updateManifestUrl: "https://example.test/release.json",
    },
  };
}

const cmds = (w: { calls: string[][] }) => w.calls.map((c) => c.join(" "));
const cfgOf = (fs: FileSystem, p: string) =>
  (fs as ReturnType<typeof createFakeFileSystem>).files.get(p);

describe("runDev", () => {
  it("app role: renders config (worker.ts), migrates local, seeds, then execs wrangler dev", async () => {
    const w = createFakeWrangler();
    const { env, fs } = makeEnv(w);
    const code = await runDev(["--port", "9000"], env);
    expect(code).toBe(0);
    const c = cmds(w);
    expect(
      c.some((x) => x.startsWith("d1 migrations apply alpha-gate-local") && x.includes("--local")),
    ).toBe(true);
    expect(c.some((x) => x.startsWith("r2 object put alpha-gate-local/build/1000/App.zip"))).toBe(
      true,
    );
    expect(
      c.some((x) => x.startsWith("d1 execute alpha-gate-local") && x.includes("--local")),
    ).toBe(true);
    expect(
      c.some(
        (x) => x.startsWith("dev --config") && x.includes("--port 9000") && x.includes("--local"),
      ),
    ).toBe(true);
    expect(cfgOf(fs, "/state/local.app.toml")).toContain('main = "/pkg/src/worker.ts"');
  });

  it("admin role: points main at the dev entry and passes DEV_ADMIN", async () => {
    const w = createFakeWrangler();
    const { env, fs } = makeEnv(w);
    await runDev(["--role", "admin"], env);
    expect(cfgOf(fs, "/state/local.admin.toml")).toContain('main = "/pkg/src/dev/admin-entry.ts"');
    expect(
      cmds(w).some((x) => x.startsWith("dev --config") && x.includes("--var DEV_ADMIN:1")),
    ).toBe(true);
  });

  // Same guard as the deploy suite: `wrangler dev` bundles too, so an npx-installed `alpha-gate dev`
  // would serve React.createElement views without an explicit --tsconfig (see core/config bundleFlags).
  it("passes --tsconfig <packageRoot>/tsconfig.json to wrangler dev", async () => {
    const w = createFakeWrangler();
    const { env } = makeEnv(w);
    await runDev([], env);
    const dev = w.calls.find((c) => c[0] === "dev");
    expect(dev).toBeDefined();
    expect(dev).toContain("--tsconfig");
    expect(dev?.[(dev?.indexOf("--tsconfig") ?? -1) + 1]).toBe("/pkg/tsconfig.json");
  });

  // rootDir is the PACKAGE — under an npm install that is node_modules, and under npx a versioned
  // cache directory that a later `npx alpha-gate@newer` abandons. Only three things may point there
  // (the Worker entry, the migrations, the tsconfig); everything durable must land in stateDir, or the
  // local D1/R2 silently disappears on the next version bump and a root-owned global install can't
  // even create it. The suite keeps the two dirs distinct so this is actually observable.
  it("writes nothing durable into the package directory", async () => {
    const w = createFakeWrangler();
    const { env, fs } = makeEnv(w);
    await runDev(["--role", "admin"], env);

    const written = [...(fs as ReturnType<typeof createFakeFileSystem>).files.keys()];
    expect(written.length).toBeGreaterThan(0); // the config + the seed archive
    expect(written.filter((p) => p.startsWith("/pkg"))).toEqual([]);
    expect(written.every((p) => p.startsWith("/state"))).toBe(true);

    // Miniflare's own D1/R2 too — it is handed over as --persist-to.
    for (const call of w.calls) {
      const i = call.indexOf("--persist-to");
      if (i !== -1) expect(call[i + 1]).toBe("/state/local-state");
    }
  });

  it("--no-seed skips the seed (no r2 put / d1 execute)", async () => {
    const w = createFakeWrangler();
    const { env } = makeEnv(w);
    await runDev(["--no-seed"], env);
    expect(cmds(w).some((x) => x.startsWith("d1 execute"))).toBe(false);
    expect(cmds(w).some((x) => x.startsWith("r2 object put"))).toBe(false);
  });

  it("rejects a bad --role or --port before doing anything", async () => {
    expect(await runDev(["--role", "bogus"], makeEnv(createFakeWrangler()).env)).toBe(1);
    expect(await runDev(["--port", "0"], makeEnv(createFakeWrangler()).env)).toBe(1);
  });

  it("aborts with a clear message when the port is already in use, never starting wrangler dev", async () => {
    const w = createFakeWrangler();
    const { env, out } = makeEnv(w);
    const code = await runDev(["--port", "8787"], { ...env, portInUse: async () => true });
    expect(code).toBe(1);
    expect(out.join("\n").toLowerCase()).toContain("in use");
    expect(cmds(w).some((x) => x.startsWith("dev --config"))).toBe(false);
    expect(cmds(w).some((x) => x.startsWith("d1 migrations"))).toBe(false); // failed fast
  });

  it("proceeds when the port is free", async () => {
    const w = createFakeWrangler();
    const { env } = makeEnv(w);
    await runDev([], { ...env, portInUse: async () => false });
    expect(cmds(w).some((x) => x.startsWith("dev --config"))).toBe(true);
  });
});
