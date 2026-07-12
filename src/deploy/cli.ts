import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DeployEnv, runDeploy } from "./commands/deploy";
import { type DevEnv, runDev } from "./commands/dev";
import { runTeardown, type TeardownEnv } from "./commands/teardown";
import { selectPalette, shouldColor } from "./core/colors";
import { nowStamp } from "./seams/clock";
import { createFileSystem } from "./seams/files";
import { createPrompt } from "./seams/io";
import { createWrangler } from "./seams/wrangler";

// The deploy CLI entry: assembles the real seams (wrangler/prompt/fs/clock), picks the color palette
// from the terminal, and dispatches to a command. Run via tsx from the thin deploy/*.sh wrappers.

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../.."); // repo root (src/deploy → ../../)

// The self-update manifest the daily cron polls. Derived from THIS checkout's git origin so every
// fork self-points with zero config (a fork's own release.json is what its instances should check);
// $UPDATE_MANIFEST_URL overrides. Falls back to the canonical upstream when origin can't be read.
const CANONICAL_MANIFEST =
  "https://raw.githubusercontent.com/alex-ivanov/alpha-gate/main/release.json";

function manifestFromGitOrigin(): string {
  if (process.env.UPDATE_MANIFEST_URL) return process.env.UPDATE_MANIFEST_URL;
  try {
    const url = execFileSync("git", ["-C", ROOT, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // Accept git@github.com:owner/repo.git and https://github.com/owner/repo(.git)
    const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/release.json`;
  } catch {
    // no git, no origin, or not a github remote — fall through
  }
  return CANONICAL_MANIFEST;
}

const HELP: Record<string, string> = {
  deploy:
    "usage: ./deploy/deploy.sh --instance <slug> [options]\n" +
    "  Provision D1 + R2, apply migrations, deploy both Workers (idempotent — re-run to update).\n" +
    "  --instance <slug>            required; namespaces everything (lowercase, digits, hyphens)\n" +
    "  --app-name / --activate-scheme / --blurb / --accent   first-init branding (prompted if unset)\n" +
    "  --access-team-domain / --access-aud   wire Cloudflare Access (both together)\n" +
    "  --email-provider none|cloudflare / --email-from <addr>   automated invites (remembered)\n" +
    "  --dry-run                    rehearse with wrangler mocked (touches nothing)\n" +
    "  --yes                        skip the confirm prompt (for non-interactive runs)",
  dev:
    "usage: ./deploy/dev.sh [options]\n" +
    "  Run Alpha Gate locally on Miniflare (no Cloudflare account). Starts BOTH Workers by default.\n" +
    "  --role app|admin             start only one Worker (default: both)\n" +
    "  --port <n>                   app port (admin is port+1 when both run; default 8787)\n" +
    "  --no-seed                    skip seeding the demo client/build\n" +
    "  --reset                      wipe local D1/R2 state first",
  teardown:
    "usage: ./deploy/teardown.sh --instance <slug> [options]\n" +
    "  Archive D1, then destroy both Workers + D1 (R2 bucket + Access app are removed manually).\n" +
    "  --instance <slug>            required\n" +
    "  --no-archive                 skip the D1 backup dump\n" +
    "  --yes                        skip the type-the-name confirmation\n" +
    "  --dry-run                    rehearse (touches nothing)",
};

// Probes whether Cloudflare Access is enabled on the admin URL. When it is, the origin 302-redirects
// an unauthenticated request to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/…` — so one
// GET both CONFIRMS Access is on and reveals the team domain, saving the operator a copy step and
// catching "you pressed Enter but didn't actually enable it". Injected so the deploy flow stays
// unit-testable offline.
async function probeAccess(
  adminUrl: string,
): Promise<{ enabled: boolean; teamDomain: string | null }> {
  try {
    const res = await fetch(adminUrl, { method: "GET", redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const m = /^https?:\/\/([^/]+\.cloudflareaccess\.com)\//.exec(location);
    if (m?.[1]) return { enabled: true, teamDomain: m[1] };
    // A 200 (or a redirect elsewhere) means Access isn't gating this hostname yet.
    return { enabled: false, teamDomain: null };
  } catch {
    return { enabled: false, teamDomain: null };
  }
}

// True if something already listens on 127.0.0.1:port (a successful TCP connect). Used by `dev` to
// catch a stale/orphaned server before wrangler falsely reports "Ready" on a port it doesn't own.
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

const shared = (rest: readonly string[]) => ({
  wrangler: createWrangler({ dryRun: rest.includes("--dry-run") }),
  prompt: createPrompt(),
  fs: createFileSystem(),
  palette: selectPalette(shouldColor(process.env, process.stdout.isTTY === true)),
  out: (line: string) => console.log(line),
  rootDir: ROOT,
  interactive: process.stdin.isTTY === true,
});

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  // Help is a first-class exit, not an "unknown flag" error (the old circular-hint bug).
  if (command === undefined || command === "--help" || command === "-h") {
    console.log("usage: <deploy|dev|teardown> [options] — run with a command + --help for details");
    return 0;
  }
  if ((rest.includes("--help") || rest.includes("-h")) && HELP[command]) {
    console.log(HELP[command]);
    return 0;
  }

  if (command === "deploy") {
    const toolVersion = (
      await readFile(path.join(ROOT, "VERSION"), "utf8").catch(() => "0.0.0")
    ).trim();
    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    const env: DeployEnv = {
      ...shared(rest),
      toolVersion,
      updateManifestUrl: manifestFromGitOrigin(),
      nodeMajor,
      probeAccess,
    };
    return runDeploy(rest, env);
  }

  if (command === "teardown") {
    const env: TeardownEnv = { ...shared(rest), nowStamp };
    return runTeardown(rest, env);
  }

  if (command === "dev") {
    const toolVersion = (
      await readFile(path.join(ROOT, "VERSION"), "utf8").catch(() => "0.0.0")
    ).trim();
    const env: DevEnv = {
      ...shared(rest),
      toolVersion,
      updateManifestUrl: manifestFromGitOrigin(),
      portInUse,
    };
    return runDev(rest, env);
  }

  console.error("usage: cli.ts <deploy|teardown|dev> [flags]");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
