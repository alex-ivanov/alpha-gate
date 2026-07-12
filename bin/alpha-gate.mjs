#!/usr/bin/env node
// The `alpha-gate` command (npm bin). One entry point over the two implementation styles:
//   deploy | dev | teardown  → the TypeScript CLI (src/deploy/cli.ts), run via tsx.
//   publish | backup         → the bash scripts (publish.sh, deploy/backup.sh) — macOS publish tools.
// Everything resolves from the package root (this file's dir), so it works from an npx cache install.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...rest] = process.argv.slice(2);

const HELP = `alpha-gate — self-hosted Cloudflare distribution gate for a Sparkle-updated macOS app

usage: alpha-gate <command> [options]

  deploy     provision + deploy an instance (D1 + R2 + both Workers); re-run to update
  dev        run locally on Miniflare (both Workers), no Cloudflare account
  publish    publish a signed build (.dmg | .app.zip) — macOS
  backup     dump an instance's D1 database to a .sql file
  teardown   archive + destroy an instance

Run \`alpha-gate <command> --help\` for a command's options.
State lives in ~/.alpha-gate (override with $ALPHA_GATE_HOME).`;

if (command === undefined || command === "--help" || command === "-h") {
  console.log(HELP);
  process.exit(command === undefined ? 1 : 0);
}

// tsx is a dependency; resolve its bin from the package's node_modules so we don't rely on `npx`.
function runTsxCli(args) {
  const tsxBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  const cli = path.join(ROOT, "src", "deploy", "cli.ts");
  const bin = existsSync(tsxBin) ? tsxBin : "tsx";
  return spawn(bin, [cli, ...args], { stdio: "inherit", cwd: ROOT });
}

function runScript(scriptRelPath, args) {
  return spawn("bash", [path.join(ROOT, scriptRelPath), ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

let child;
switch (command) {
  case "deploy":
  case "dev":
  case "teardown":
    child = runTsxCli([command, ...rest]);
    break;
  case "publish":
    child = runScript("publish.sh", rest);
    break;
  case "backup":
    child = runScript("deploy/backup.sh", rest);
    break;
  default:
    console.error(`unknown command: ${command}\n`);
    console.error(HELP);
    process.exit(1);
}

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error(`failed to run '${command}': ${err.message}`);
  process.exit(1);
});
