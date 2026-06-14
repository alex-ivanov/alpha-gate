import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DeployEnv, runDeploy } from "./commands/deploy";
import { selectPalette, shouldColor } from "./core/colors";
import { createFileSystem } from "./seams/files";
import { createPrompt } from "./seams/io";
import { createWrangler } from "./seams/wrangler";

// The deploy CLI entry: assembles the real seams (wrangler/prompt/fs), reads VERSION + node version,
// picks the color palette from the terminal, and dispatches to a command. Run via tsx from the thin
// deploy/*.sh wrappers. teardown/dev land in later increments.

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../.."); // repo root (src/deploy → ../../)

const DEFAULT_MANIFEST = "https://raw.githubusercontent.com/your-org/alpha-gate/main/release.json";

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (command !== "deploy") {
    console.error("usage: cli.ts deploy [flags]   (teardown/dev are coming in later increments)");
    return 1;
  }

  const toolVersion = (
    await readFile(path.join(ROOT, "VERSION"), "utf8").catch(() => "0.0.0")
  ).trim();
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

  const env: DeployEnv = {
    wrangler: createWrangler({ dryRun: rest.includes("--dry-run") }),
    prompt: createPrompt(),
    fs: createFileSystem(),
    palette: selectPalette(shouldColor(process.env, process.stdout.isTTY === true)),
    out: (line) => console.log(line),
    rootDir: ROOT,
    toolVersion,
    updateManifestUrl: process.env.UPDATE_MANIFEST_URL ?? DEFAULT_MANIFEST,
    nodeMajor,
    interactive: process.stdin.isTTY === true,
  };
  return runDeploy(rest, env);
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
