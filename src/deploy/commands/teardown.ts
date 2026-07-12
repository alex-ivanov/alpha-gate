import { parseTeardownArgs } from "../core/args";
import type { Palette } from "../core/colors";
import { resourceName } from "../core/plan";
import type { ApplyStep } from "../core/types";
import { renderDestroy, renderHeader } from "../core/ui";
import type { FileSystem } from "../seams/files";
import type { Prompt } from "../seams/io";
import type { Wrangler } from "../seams/wrangler";

// The `teardown` command (§21): archive D1 first (unless --no-archive), then delete both Workers + the
// database. The R2 bucket and the Cloudflare Access app can't be removed with pure wrangler (no bulk
// R2 list; no Access API), so it deletes the bucket only if already empty and prints the manual steps.
// Destructive — confirmed by typing the instance name (or --yes). All I/O via injected seams.

export interface TeardownEnv {
  wrangler: Wrangler;
  prompt: Prompt;
  fs: FileSystem;
  palette: Palette;
  out: (line: string) => void;
  rootDir: string;
  /** Where this instance's state lives — must match deploy (see core/paths). */
  stateDir: string;
  nowStamp: () => string;
  interactive: boolean;
}

function fail(env: TeardownEnv, reason: string, hint: string): number {
  env.out(env.palette.red(`teardown: ${reason}`));
  if (hint) env.out(`  → ${hint}`);
  return 1;
}

export async function runTeardown(argv: readonly string[], env: TeardownEnv): Promise<number> {
  const parsed = parseTeardownArgs(argv);
  if (!parsed.ok) return fail(env, parsed.error, parsed.hint ?? "");
  const args = parsed.value;
  const res = resourceName(args.instance);
  const deployDir = env.stateDir;
  const archiveDir = args.archiveDir ?? deployDir;
  const archiveFile = `${archiveDir}/${args.instance}-${env.nowStamp()}.sql`;
  const wr = env.wrangler;

  env.out(renderHeader(args.instance, env.palette));

  if (!args.dryRun) {
    const who = await wr.run(["whoami"]);
    if (!who.ok)
      return fail(env, "not authenticated to Cloudflare", "run once: npx wrangler login");
  }

  // The destructive plan, shown before anything runs.
  const plan: ApplyStep[] = [];
  if (args.archive) {
    plan.push({
      kind: "create",
      what: "archive D1",
      why: "",
      command: `wrangler d1 export ${res} --remote`,
    });
  }
  plan.push({
    kind: "delete",
    what: "app Worker",
    why: "",
    command: `wrangler delete --name ${res}`,
  });
  plan.push({
    kind: "delete",
    what: "admin Worker",
    why: "",
    command: `wrangler delete --name ${res}-admin`,
  });
  plan.push({ kind: "delete", what: "database", why: "", command: `wrangler d1 delete ${res}` });
  plan.push({
    kind: "delete",
    what: "R2 bucket",
    why: "only if already empty",
    command: `wrangler r2 bucket delete ${res}`,
  });
  env.out(renderDestroy(plan, env.palette));

  // Confirm by typing the instance name (or --yes). Non-interactive without --yes → refuse, don't hang.
  if (!args.dryRun && !args.yes) {
    if (!env.interactive) {
      return fail(env, "destructive run isn't interactive", "re-run with --yes to confirm");
    }
    const typed = await env.prompt.ask(`Type the instance name "${args.instance}" to confirm: `);
    if (typed !== args.instance) {
      env.out("aborted — nothing was deleted.");
      return 1;
    }
  }

  env.out("");
  env.out(env.palette.bold("Tearing down…"));
  const startStep = (label: string): void => env.out(env.palette.dim(`  → ${label}…`));
  const doneStep = (label: string, extra = ""): void =>
    env.out(env.palette.green(`  ✓ ${label}${extra === "" ? "" : `  ${extra}`}`));

  // 1. Archive D1 BEFORE destroying (it must still exist). Abort on failure unless --no-archive.
  if (args.archive) {
    startStep("archive database");
    const exported = await wr.run(["d1", "export", res, "--remote", "--output", archiveFile]);
    if (!args.dryRun && !exported.ok) {
      return fail(
        env,
        "D1 export failed — nothing was destroyed",
        "fix the error above, or re-run with --no-archive to destroy without a backup",
      );
    }
    doneStep("archive", archiveFile);
  }

  // 2. Delete both Workers (tolerate already-gone — re-runs/partial teardown are fine).
  startStep("delete app Worker");
  await wr.run(["delete", "--name", res]);
  doneStep("app Worker");
  startStep("delete admin Worker");
  await wr.run(["delete", "--name", `${res}-admin`]);
  doneStep("admin Worker");

  // 3. R2 — deletes only if empty (pure wrangler can't list/empty a bucket); report if it survives.
  startStep("delete R2 bucket");
  const r2 = await wr.run(["r2", "bucket", "delete", res]);
  const r2Left = !args.dryRun && !r2.ok;
  if (r2Left) env.out(env.palette.yellow(`  ! R2 bucket ${res} not deleted (likely non-empty)`));
  else doneStep("R2 bucket");

  // 4. D1 database.
  startStep("delete database");
  await wr.run(["d1", "delete", res, "--skip-confirmation"]);
  doneStep("database");

  // 5. Local config + state (real runs only — dry-run must not touch the filesystem).
  if (!args.dryRun) {
    await env.fs.remove(`${deployDir}/${args.instance}.app.toml`);
    await env.fs.remove(`${deployDir}/${args.instance}.admin.toml`);
    await env.fs.remove(`${deployDir}/${args.instance}.state.json`);
  }

  env.out("");
  env.out(
    env.palette.green(`Removed ${args.instance}: both Workers and the D1 database are gone.`),
  );
  if (args.archive) {
    env.out(`  Database archived → ${archiveFile}  (contains live tokens — store it safely)`);
  }
  env.out("Finish by hand (pure wrangler can't):");
  if (r2Left) {
    env.out(
      `  - Empty + delete the R2 bucket '${res}' in the dashboard (R2 → the bucket → delete).`,
    );
  }
  env.out(
    `  - Remove the Cloudflare Access app for '${res}-admin' (Zero Trust → Access → Applications).`,
  );
  return 0;
}
