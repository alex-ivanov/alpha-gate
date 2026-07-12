import { describe, expect, it } from "vitest";
import { type DeployEnv, runDeploy } from "../../src/deploy/commands/deploy";
import { plainPalette } from "../../src/deploy/core/colors";
import { createFakeFileSystem, type FileSystem } from "../../src/deploy/seams/files";
import { createFakePrompt, type Prompt } from "../../src/deploy/seams/io";
import { createFakeWrangler, type Wrangler } from "../../src/deploy/seams/wrangler";

// Orchestration tests: a scripted wrangler + prompt + in-memory fs let us assert the command sequence,
// idempotent re-run skips, fail-loud-on-empty-URL, and the preflight gate — with no real Cloudflare.

interface Scenario {
  d1Exists?: boolean;
  bucketExists?: boolean;
  accessConfigured?: boolean;
  deployUrls?: boolean;
}

function fakeWrangler(s: Scenario): Wrangler & { calls: string[][] } {
  let d1 = s.d1Exists ?? false;
  let bucket = s.bucketExists ?? false;
  return createFakeWrangler((args) => {
    const [a, b, c] = args;
    if (a === "whoami") return { ok: true };
    if (a === "d1" && b === "list") {
      return { stdout: d1 ? JSON.stringify([{ name: "alpha-gate-x", uuid: "uuid-1234" }]) : "[]" };
    }
    if (a === "d1" && b === "create") {
      d1 = true;
      return { ok: true };
    }
    if (a === "r2" && b === "bucket" && c === "info") return { ok: bucket };
    if (a === "r2" && b === "bucket" && c === "create") {
      bucket = true;
      return { ok: true };
    }
    if (a === "secret" && b === "list") {
      return {
        stdout: s.accessConfigured ? JSON.stringify([{ name: "ACCESS_TEAM_DOMAIN" }]) : "[]",
      };
    }
    if (a === "deploy") {
      return {
        stdout: s.deployUrls === false ? "no url here" : "https://alpha-gate-x.acct.workers.dev",
      };
    }
    return { ok: true };
  });
}

function makeEnv(
  wrangler: Wrangler,
  opts: {
    nodeMajor?: number;
    prompt?: Prompt;
    fs?: FileSystem;
    interactive?: boolean;
    probeAccess?: DeployEnv["probeAccess"];
  } = {},
): { env: DeployEnv; out: string[]; fs: FileSystem } {
  const out: string[] = [];
  const fs = opts.fs ?? createFakeFileSystem();
  return {
    out,
    fs,
    env: {
      wrangler,
      prompt: opts.prompt ?? createFakePrompt([]),
      fs,
      palette: plainPalette,
      out: (line) => out.push(line),
      rootDir: "/repo",
      toolVersion: "0.1.0",
      updateManifestUrl: "https://example.test/release.json",
      nodeMajor: opts.nodeMajor ?? 20,
      interactive: opts.interactive ?? true,
      probeAccess: opts.probeAccess,
    },
  };
}

const cmds = (w: { calls: string[][] }) => w.calls.map((c) => c.join(" "));

describe("runDeploy — fresh instance", () => {
  it("creates db + bucket, migrates, seeds, deploys both, wires Access, and writes state", async () => {
    const w = fakeWrangler({});
    const { env, fs, out } = makeEnv(w);
    const code = await runDeploy(
      [
        "--instance",
        "x",
        "--app-name",
        "Acme",
        "--yes",
        "--access-team-domain",
        "t.cloudflareaccess.com",
        "--access-aud",
        "AUD",
      ],
      env,
    );
    expect(code).toBe(0);
    // Live per-step progress (the ✓ marks) is printed as each step lands.
    const log = out.join("\n");
    expect(log).toContain("✓ database");
    expect(log).toContain("✓ app Worker");
    expect(log).toContain("✓ Access");
    const c = cmds(w);
    expect(c).toContain("d1 create alpha-gate-x");
    expect(c).toContain("r2 bucket create alpha-gate-x");
    expect(c.some((x) => x.startsWith("d1 migrations apply alpha-gate-x"))).toBe(true);
    expect(c.some((x) => x.startsWith("d1 execute alpha-gate-x"))).toBe(true); // seeded (--app-name)
    expect(c.filter((x) => x.startsWith("deploy --config")).length).toBeGreaterThanOrEqual(2);
    expect(c.some((x) => x.includes("--secrets-file"))).toBe(true); // Access via one deploy
    expect(
      (fs as ReturnType<typeof createFakeFileSystem>).files.has("/repo/.deploy/x.app.toml"),
    ).toBe(true);
    expect(
      (fs as ReturnType<typeof createFakeFileSystem>).files.has("/repo/.deploy/x.state.json"),
    ).toBe(true);
  });
});

describe("runDeploy — idempotent re-run", () => {
  it("skips create for existing db/bucket and skips seeding", async () => {
    const w = fakeWrangler({ d1Exists: true, bucketExists: true, accessConfigured: true });
    const { env } = makeEnv(w);
    const code = await runDeploy(["--instance", "x", "--app-name", "Acme", "--yes"], env);
    expect(code).toBe(0);
    const c = cmds(w);
    expect(c).not.toContain("d1 create alpha-gate-x");
    expect(c).not.toContain("r2 bucket create alpha-gate-x");
    expect(c.some((x) => x.startsWith("d1 execute"))).toBe(false); // not a fresh db → no seed
  });
});

describe("runDeploy — guards", () => {
  it("fails loudly (exit 1) when a deploy produced no URL", async () => {
    const w = fakeWrangler({ deployUrls: false });
    const { env } = makeEnv(w);
    expect(await runDeploy(["--instance", "x", "--yes"], env)).toBe(1);
  });

  it("fails preflight on Node < 20 and never mutates", async () => {
    const w = fakeWrangler({});
    const { env } = makeEnv(w, { nodeMajor: 18 });
    expect(await runDeploy(["--instance", "x", "--yes"], env)).toBe(1);
    expect(cmds(w).some((x) => x.startsWith("d1 create"))).toBe(false);
  });

  it("rejects bad args with exit 1 before touching wrangler", async () => {
    const w = fakeWrangler({});
    const { env } = makeEnv(w);
    expect(await runDeploy(["--instance", "Bad_Name"], env)).toBe(1);
    expect(w.calls).toHaveLength(0);
  });
});

describe("runDeploy — manual Access flow", () => {
  it("shows the manual step, waits, collects creds, then wires Access", async () => {
    const w = fakeWrangler({});
    // branding via flags (no branding prompts); then confirm "y", waitForDone "", team, AUD.
    const prompt = createFakePrompt(["y", "", "t.cloudflareaccess.com", "AUD"]);
    const { env, out } = makeEnv(w, { prompt });
    const code = await runDeploy(
      [
        "--instance",
        "x",
        "--app-name",
        "Acme",
        "--activate-scheme",
        "acme",
        "--blurb",
        "b",
        "--accent",
        "#111",
      ],
      env,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("MANUAL STEP");
    expect(cmds(w).some((x) => x.includes("--secrets-file"))).toBe(true);
  });

  it("does not prompt when non-interactive without --yes — it errors and tells you to pass --yes", async () => {
    const w = fakeWrangler({});
    const { env } = makeEnv(w, { interactive: false });
    expect(await runDeploy(["--instance", "x"], env)).toBe(1);
    // Never reached the mutating apply (no create).
    expect(cmds(w).some((x) => x.startsWith("d1 create"))).toBe(false);
  });

  it("derives the team domain from the Access probe — the operator copies only the AUD", async () => {
    const w = fakeWrangler({});
    // confirm "y", waitForDone "", then just the AUD (no team-domain prompt — probe supplies it).
    const prompt = createFakePrompt(["y", "", "0123456789abcdef0123456789abcdef"]);
    const probeAccess = async () => ({
      enabled: true,
      teamDomain: "myteam.cloudflareaccess.com",
    });
    const { env, out } = makeEnv(w, { prompt, probeAccess });
    const code = await runDeploy(
      [
        "--instance",
        "x",
        "--app-name",
        "A",
        "--activate-scheme",
        "a",
        "--blurb",
        "",
        "--accent",
        "#1",
      ],
      env,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("detected team domain: myteam.cloudflareaccess.com");
    expect(cmds(w).some((x) => x.includes("--secrets-file"))).toBe(true);
  });
});

describe("runDeploy — remembered inputs", () => {
  it("a bare re-run keeps the email settings from the last deploy (no silent revert)", async () => {
    const w = fakeWrangler({ d1Exists: true, bucketExists: true, accessConfigured: true });
    const fs = createFakeFileSystem();
    // Prior state recorded cloudflare email; this run passes NO --email-provider.
    await fs.write(
      "/repo/.deploy/x.state.json",
      JSON.stringify({ instance: "x", email_provider: "cloudflare", email_from: "a@b.dev" }),
    );
    const { env, out } = makeEnv(w, { fs, prompt: createFakePrompt(["y"]) });
    expect(await runDeploy(["--instance", "x", "--yes"], env)).toBe(0);
    // The rendered admin config keeps cloudflare email (not reverted to none).
    const adminCfg = (await fs.read("/repo/.deploy/x.admin.toml")) ?? "";
    expect(adminCfg).toContain("cloudflare");
    expect(out.join("\n")).toContain("reusing email");
  });
});

describe("runDeploy — first-init branding prompts", () => {
  it("prompts for unset branding on a fresh interactive run and seeds the answers", async () => {
    const w = fakeWrangler({});
    // app name, activate scheme, blurb, accent, then confirm. Access creds via flags (no manual wait).
    const prompt = createFakePrompt(["My App", "scheme", "", "", "y"]);
    const { env } = makeEnv(w, { prompt });
    const code = await runDeploy(
      ["--instance", "x", "--access-team-domain", "t.cloudflareaccess.com", "--access-aud", "AUD"],
      env,
    );
    expect(code).toBe(0);
    const seed = cmds(w).find((x) => x.startsWith("d1 execute"));
    expect(seed).toContain("My App"); // the prompted app name was seeded
    expect(seed).toContain("scheme");
  });
});
