#!/usr/bin/env node
// The `alpha-gate` command (npm bin). One entry point over the two implementation styles:
//   deploy | dev | teardown  → the TypeScript CLI (src/deploy/cli.ts), run via tsx.
//   publish | backup         → the bash scripts (publish.sh, deploy/backup.sh) — macOS publish tools.
// Everything resolves from the package root (this file's dir), so it works from an npx cache install.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

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

// tsx is a dependency, but WHERE it lands depends on the install. A git checkout has it in
// `<ROOT>/node_modules/.bin`; npm/npx hoist it to the PARENT `node_modules/.bin`, next to us rather
// than inside us — so a `<ROOT>/node_modules/.bin` probe misses, and the bare-name fallback only
// works because npx happens to put the hoisted `.bin` on PATH. `npm i alpha-gate` followed by
// `./node_modules/.bin/alpha-gate deploy` gets no such PATH and dies with `spawn tsx ENOENT`.
//
// So: ask Node's own resolver where tsx is (it walks up node_modules exactly like an import would,
// hoisted or not), read the real entry out of its package.json, and run it with THIS node binary.
// No PATH, no shell shim, no platform-specific .cmd.
function resolveTsxEntry() {
  try {
    const pkgPath = require.resolve("tsx/package.json");
    const { bin } = JSON.parse(readFileSync(pkgPath, "utf8"));
    const rel = typeof bin === "string" ? bin : bin?.tsx;
    if (typeof rel === "string") {
      const entry = path.resolve(path.dirname(pkgPath), rel);
      if (existsSync(entry)) return entry;
    }
  } catch {
    // Fall through to the PATH-based shim below.
  }
  return null;
}

function runTsxCli(args) {
  const cli = path.join(ROOT, "src", "deploy", "cli.ts");
  const entry = resolveTsxEntry();
  if (entry !== null) {
    return spawn(process.execPath, [entry, cli, ...args], { stdio: "inherit", cwd: ROOT });
  }
  // Last resort: whatever `tsx` PATH offers (a global install, or npx's own bin dir).
  const shim = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return spawn(shim, [cli, ...args], { stdio: "inherit", cwd: ROOT });
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
