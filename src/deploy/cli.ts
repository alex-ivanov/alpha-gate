import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DeployEnv, runDeploy } from "./commands/deploy";
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

  console.error("usage: cli.ts <deploy|teardown> [flags]   (dev lands next)");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
