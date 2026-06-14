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

const DEFAULT_MANIFEST = "https://raw.githubusercontent.com/your-org/alpha-gate/main/release.json";

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

  if (command === "deploy") {
    const toolVersion = (
      await readFile(path.join(ROOT, "VERSION"), "utf8").catch(() => "0.0.0")
    ).trim();
    const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    const env: DeployEnv = {
      ...shared(rest),
      toolVersion,
      updateManifestUrl: process.env.UPDATE_MANIFEST_URL ?? DEFAULT_MANIFEST,
      nodeMajor,
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
      updateManifestUrl: process.env.UPDATE_MANIFEST_URL ?? DEFAULT_MANIFEST,
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
