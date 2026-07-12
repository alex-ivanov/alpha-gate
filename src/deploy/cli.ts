import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DeployEnv, runDeploy } from "./commands/deploy";
import { type DevEnv, runDev } from "./commands/dev";
import { runTeardown, type TeardownEnv } from "./commands/teardown";
import { selectPalette, shouldColor } from "./core/colors";
import { resolveStateDir } from "./core/paths";
import { nowStamp } from "./seams/clock";
import { createFileSystem } from "./seams/files";
import { createPrompt } from "./seams/io";
import { createWrangler } from "./seams/wrangler";

// The deploy CLI entry: assembles the real seams (wrangler/prompt/fs/clock), picks the color palette
// from the terminal, and dispatches to a command. Run via tsx from the thin deploy/*.sh wrappers OR
// from the npm `bin` (npx alpha-gate …).

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../.."); // package root (src/deploy → ../../)

// State lives at <root>/.deploy for a git checkout, ~/.alpha-gate for an npm install (the package
// files are in the ephemeral npm cache; state there would vanish on the next version). See core/paths.
const STATE_DIR = resolveStateDir({
  packageRoot: ROOT,
  home: process.env.ALPHA_GATE_HOME,
  userHome: homedir(),
  isGitCheckout: existsSync(path.join(ROOT, ".git")),
});

// The self-update manifest the daily cron polls: the npm registry's `/latest` endpoint for THIS
// package, so the deployed Worker's banner tracks whatever version is published to npm. Derived from
// package.json's `name`; $UPDATE_MANIFEST_URL overrides (e.g. to point at a fork's own package or a
// static release.json). Until the package is published to npm, the fetch just 404s and the banner
// stays quiet — a graceful no-op, same as before.
function readPkg(): { name?: string; version?: string } {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function npmManifestUrl(): string {
  if (process.env.UPDATE_MANIFEST_URL) return process.env.UPDATE_MANIFEST_URL;
  const name = readPkg().name ?? "alpha-gate";
  return `https://registry.npmjs.org/${name}/latest`;
}

// TOOL_VERSION baked into the deployed Worker = the version that deployed it, so the banner compares
// like-for-like against npm's latest. package.json is the npm source of truth; VERSION is the fallback.
function toolVersion(): string {
  const fromPkg = readPkg().version;
  if (typeof fromPkg === "string" && fromPkg.length > 0) return fromPkg;
  try {
    return readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  } catch {
    return "0.0.0";
  }
}

const HELP: Record<string, string> = {
  deploy:
    "usage: deploy --instance <slug> [options]  (./deploy/deploy.sh or: alpha-gate deploy)\n" +
    "  Provision D1 + R2, apply migrations, deploy both Workers (idempotent — re-run to update).\n" +
    "  --instance <slug>            required; namespaces everything (lowercase, digits, hyphens)\n" +
    "  --app-name / --activate-scheme / --blurb / --accent   first-init branding (prompted if unset)\n" +
    "  --access-team-domain / --access-aud   wire Cloudflare Access (both together)\n" +
    "  --email-provider none|cloudflare / --email-from <addr>   automated invites (remembered)\n" +
    "  --dry-run                    rehearse with wrangler mocked (touches nothing)\n" +
    "  --yes                        skip the confirm prompt (for non-interactive runs)",
  dev:
    "usage: dev [options]  (./deploy/dev.sh or: alpha-gate dev)\n" +
    "  Run Alpha Gate locally on Miniflare (no Cloudflare account). Starts BOTH Workers by default.\n" +
    "  --role app|admin             start only one Worker (default: both)\n" +
    "  --port <n>                   app port (admin is port+1 when both run; default 8787)\n" +
    "  --no-seed                    skip seeding the demo client/build\n" +
    "  --reset                      wipe local D1/R2 state first",
  teardown:
    "usage: teardown --instance <slug> [options]  (./deploy/teardown.sh or: alpha-gate teardown)\n" +
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
  // cwd = the package root so `npx wrangler` finds the bundled wrangler even from an npx install.
  wrangler: createWrangler({ dryRun: rest.includes("--dry-run"), cwd: ROOT }),
  prompt: createPrompt(),
  fs: createFileSystem(),
  palette: selectPalette(shouldColor(process.env, process.stdout.isTTY === true)),
  out: (line: string) => console.log(line),
  rootDir: ROOT,
  stateDir: STATE_DIR,
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
    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    const env: DeployEnv = {
      ...shared(rest),
      toolVersion: toolVersion(),
      updateManifestUrl: npmManifestUrl(),
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
    const env: DevEnv = {
      ...shared(rest),
      toolVersion: toolVersion(),
      updateManifestUrl: npmManifestUrl(),
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
