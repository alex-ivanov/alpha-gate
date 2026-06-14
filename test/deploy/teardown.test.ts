import { describe, expect, it } from "vitest";
import { runTeardown, type TeardownEnv } from "../../src/deploy/commands/teardown";
import { plainPalette } from "../../src/deploy/core/colors";
import { createFakeFileSystem, type FileSystem } from "../../src/deploy/seams/files";
import { createFakePrompt, type Prompt } from "../../src/deploy/seams/io";
import { createFakeWrangler, type Wrangler } from "../../src/deploy/seams/wrangler";

function fakeWrangler(opts: { exportOk?: boolean; r2Ok?: boolean } = {}): Wrangler & {
  calls: string[][];
} {
  return createFakeWrangler((args) => {
    const [a, b] = args;
    if (a === "whoami") return { ok: true };
    if (a === "d1" && b === "export") return { ok: opts.exportOk ?? true };
    if (a === "r2" && b === "bucket") return { ok: opts.r2Ok ?? true };
    return { ok: true };
  });
}

function seededFs(): FileSystem & { files: Map<string, string> } {
  return createFakeFileSystem({
    "/repo/.deploy/x.app.toml": "app",
    "/repo/.deploy/x.admin.toml": "admin",
    "/repo/.deploy/x.state.json": "{}",
  });
}

function makeEnv(
  w: Wrangler,
  opts: { prompt?: Prompt; fs?: FileSystem; interactive?: boolean } = {},
): { env: TeardownEnv; out: string[]; fs: FileSystem } {
  const out: string[] = [];
  const fs = opts.fs ?? seededFs();
  return {
    out,
    fs,
    env: {
      wrangler: w,
      prompt: opts.prompt ?? createFakePrompt([]),
      fs,
      palette: plainPalette,
      out: (line) => out.push(line),
      rootDir: "/repo",
      nowStamp: () => "20260101T000000Z",
      interactive: opts.interactive ?? true,
    },
  };
}

const cmds = (w: { calls: string[][] }) => w.calls.map((c) => c.join(" "));
const asMap = (fs: FileSystem) => (fs as ReturnType<typeof createFakeFileSystem>).files;

describe("runTeardown", () => {
  it("archives D1 first, then deletes both Workers, the bucket, the db, and local files", async () => {
    const w = fakeWrangler();
    const { env, fs } = makeEnv(w, { prompt: createFakePrompt(["x"]) }); // type the name to confirm
    const code = await runTeardown(["--instance", "x"], env);
    expect(code).toBe(0);
    const c = cmds(w);
    const exportIdx = c.findIndex((x) => x.startsWith("d1 export"));
    const delIdx = c.findIndex((x) => x.startsWith("delete --name"));
    expect(exportIdx).toBeGreaterThanOrEqual(0);
    expect(exportIdx).toBeLessThan(delIdx); // archive happens before any deletion
    expect(c).toContain("delete --name alpha-gate-x");
    expect(c).toContain("delete --name alpha-gate-x-admin");
    expect(c.some((x) => x.startsWith("d1 delete alpha-gate-x"))).toBe(true);
    expect(c).toContain("r2 bucket delete alpha-gate-x");
    expect(asMap(fs).has("/repo/.deploy/x.app.toml")).toBe(false); // local files removed
    expect(asMap(fs).has("/repo/.deploy/x.state.json")).toBe(false);
  });

  it("--no-archive skips the export", async () => {
    const w = fakeWrangler();
    const { env } = makeEnv(w, { prompt: createFakePrompt(["x"]) });
    await runTeardown(["--instance", "x", "--no-archive"], env);
    expect(cmds(w).some((x) => x.startsWith("d1 export"))).toBe(false);
  });

  it("aborts WITHOUT deleting when the archive export fails", async () => {
    const w = fakeWrangler({ exportOk: false });
    const { env, fs } = makeEnv(w, { prompt: createFakePrompt(["x"]) });
    expect(await runTeardown(["--instance", "x"], env)).toBe(1);
    expect(cmds(w).some((x) => x.startsWith("delete --name"))).toBe(false); // nothing destroyed
    expect(asMap(fs).has("/repo/.deploy/x.app.toml")).toBe(true); // files untouched
  });

  it("aborts when the typed confirmation doesn't match the instance name", async () => {
    const w = fakeWrangler();
    const { env } = makeEnv(w, { prompt: createFakePrompt(["wrong"]) });
    expect(await runTeardown(["--instance", "x"], env)).toBe(1);
    expect(cmds(w).some((x) => x.startsWith("delete --name"))).toBe(false);
  });

  it("refuses a non-interactive run without --yes", async () => {
    const w = fakeWrangler();
    const { env } = makeEnv(w, { interactive: false });
    expect(await runTeardown(["--instance", "x"], env)).toBe(1);
    expect(cmds(w).some((x) => x.startsWith("delete --name"))).toBe(false);
  });

  it("--yes skips confirmation and proceeds", async () => {
    const w = fakeWrangler();
    const { env } = makeEnv(w);
    expect(await runTeardown(["--instance", "x", "--yes"], env)).toBe(0);
    expect(cmds(w)).toContain("delete --name alpha-gate-x");
  });

  it("reports a surviving (non-empty) R2 bucket but still deletes the database", async () => {
    const w = fakeWrangler({ r2Ok: false });
    const { env, out } = makeEnv(w, { prompt: createFakePrompt(["x"]) });
    expect(await runTeardown(["--instance", "x"], env)).toBe(0);
    expect(out.join("\n")).toContain("not deleted");
    expect(cmds(w).some((x) => x.startsWith("d1 delete alpha-gate-x"))).toBe(true);
  });
});
