import { normalizeTeamDomain, parseDeployArgs } from "../core/args";
import type { Palette } from "../core/colors";
import { type ConfigVars, renderConfig } from "../core/config";
import { accessConfigured, extractDeployUrl, parseD1Id } from "../core/parse";
import {
  accessManualNeeded,
  buildApplyPlan,
  buildSeedSql,
  type Inspection,
  inspectionFindings,
  inspectSteps,
  resourceName,
} from "../core/plan";
import { parseState, serializeState } from "../core/state";
import type { Role } from "../core/types";
import {
  renderApply,
  renderFindings,
  renderHeader,
  renderInspect,
  renderManualStep,
  renderPreflight,
} from "../core/ui";
import type { FileSystem } from "../seams/files";
import type { Prompt } from "../seams/io";
import type { Wrangler } from "../seams/wrangler";

// The `deploy` command: preflight → INSPECT (read-only, learn state) → APPLY (create/migrate/seed/
// deploy/wire-Access). It renders the transparent grouped-panels UI, confirms before mutating, and
// fails loudly (clear reason) rather than writing poison. All I/O is via injected seams, so the whole
// flow is unit-tested with a fake wrangler/prompt/fs.

export interface DeployEnv {
  wrangler: Wrangler;
  prompt: Prompt;
  fs: FileSystem;
  palette: Palette;
  out: (line: string) => void;
  rootDir: string;
  toolVersion: string;
  updateManifestUrl: string;
  nodeMajor: number;
  /** Whether stdin is a TTY — gates interactive prompts (the manual-Access wait + first-init branding). */
  interactive: boolean;
}

function fail(env: DeployEnv, reason: string, hint: string): number {
  env.out(env.palette.red(`deploy: ${reason}`));
  if (hint) env.out(`  → ${hint}`);
  return 1;
}

async function askNonEmpty(prompt: Prompt, question: string): Promise<string> {
  let answer = "";
  while (answer === "") {
    answer = (await prompt.ask(`  ${question}: `)).trim();
  }
  return answer;
}

async function askWithDefault(prompt: Prompt, label: string, fallback: string): Promise<string> {
  const suffix = fallback === "" ? "" : ` [${fallback}]`;
  const answer = (await prompt.ask(`  ${label}${suffix}: `)).trim();
  return answer === "" ? fallback : answer;
}

export async function runDeploy(argv: readonly string[], env: DeployEnv): Promise<number> {
  const parsed = parseDeployArgs(argv);
  if (!parsed.ok) return fail(env, parsed.error, parsed.hint ?? "");
  const args = parsed.value;
  const res = resourceName(args.instance);
  const deployDir = `${env.rootDir}/.deploy`;
  const appCfg = `${deployDir}/${args.instance}.app.toml`;
  const adminCfg = `${deployDir}/${args.instance}.admin.toml`;
  const wr = env.wrangler;

  env.out(renderHeader(args.instance, env.palette));

  // PREFLIGHT — tools + Cloudflare auth (auth skipped in dry-run).
  const preflight = [
    {
      name: "node",
      ok: env.nodeMajor >= 20,
      detail:
        env.nodeMajor >= 20 ? `node ${env.nodeMajor}` : "Node ≥ 20 required (https://nodejs.org)",
    },
  ];
  if (!args.dryRun) {
    const who = await wr.run(["whoami"]);
    preflight.push({
      name: "cloudflare",
      ok: who.ok,
      detail: who.ok ? "authenticated" : "not logged in → run: npx wrangler login",
    });
  }
  env.out(renderPreflight(preflight, env.palette));
  if (preflight.some((p) => !p.ok))
    return fail(env, "preflight failed", "fix the items above, then re-run");

  // INSPECT — read-only.
  env.out(renderInspect(inspectSteps(args), env.palette));
  let inspection: Inspection;
  if (args.dryRun) {
    inspection = { d1Id: null, bucketExists: false, accessConfigured: false, seeded: false };
  } else {
    const list = await wr.run(["d1", "list", "--json"]);
    const d1Id = parseD1Id(list.stdout, res);
    const bucket = await wr.run(["r2", "bucket", "info", res]);
    const secrets = await wr.run(["secret", "list", "--config", adminCfg, "--format", "json"]);
    inspection = {
      d1Id,
      bucketExists: bucket.ok,
      accessConfigured: accessConfigured(secrets.stdout),
      seeded: d1Id !== null,
    };
  }
  env.out(renderFindings(inspectionFindings(inspection), env.palette));

  const freshDb = inspection.d1Id === null;

  // First-init branding (parity with the old deploy.sh): on a fresh instance + an interactive TTY,
  // prompt for anything not passed as a flag, so /get + the activate link are correct immediately. The
  // values are seeded with INSERT OR IGNORE, so the admin Settings page owns them thereafter.
  let effective = args;
  if (freshDb && env.interactive && !args.yes && !args.dryRun) {
    effective = {
      ...args,
      appName: args.appName ?? (await askWithDefault(env.prompt, "App name", "Your App")),
      activateScheme:
        args.activateScheme ?? (await askWithDefault(env.prompt, "Activate URL scheme", "myapp")),
      blurb: args.blurb ?? (await askWithDefault(env.prompt, "Short blurb (optional)", "")),
      accent: args.accent ?? (await askWithDefault(env.prompt, "Accent colour", "#0A84FF")),
    };
  }

  // APPLY — show the plan, confirm, then mutate.
  env.out(renderApply(buildApplyPlan(effective, inspection), env.palette));
  if (!args.dryRun && !args.yes) {
    if (!env.interactive) {
      return fail(
        env,
        "this run would change resources but isn't interactive",
        "re-run with --yes to proceed",
      );
    }
    if (!(await env.prompt.confirm("Apply these changes?"))) {
      env.out("aborted — nothing changed.");
      return 1;
    }
  }

  await env.fs.mkdirp(deployDir);
  const statePath = `${deployDir}/${args.instance}.state.json`;
  let state = parseState((await env.fs.read(statePath)) ?? "", args.instance);

  // 1. D1 (create if absent, then resolve its id).
  let d1Id = inspection.d1Id;
  if (d1Id === null) {
    const created = await wr.run(["d1", "create", res]);
    if (args.dryRun) {
      d1Id = "dry-run-d1-id";
    } else {
      if (!created.ok) return fail(env, "could not create the D1 database", created.stderr.trim());
      const relist = await wr.run(["d1", "list", "--json"]);
      d1Id = parseD1Id(relist.stdout, res);
    }
  }
  if (d1Id === null)
    return fail(env, "D1 created but no id was returned", "check your account quota");
  const databaseId: string = d1Id; // const so the closure below captures the narrowed (non-null) value
  state = { ...state, d1Id: databaseId };

  // 2. Render both configs (needs the resolved d1Id; written before migrate/deploy use --config).
  const configVars = (role: Role): ConfigVars => ({
    instance: args.instance,
    d1Id: databaseId,
    role,
    name: role === "admin" ? `${res}-admin` : res,
    emailProvider: args.emailProvider,
    emailFrom: args.emailFrom ?? "",
    toolVersion: env.toolVersion,
    updateManifestUrl: env.updateManifestUrl,
    main: "../src/worker.ts",
  });
  await env.fs.write(appCfg, renderConfig(configVars("app")));
  await env.fs.write(adminCfg, renderConfig(configVars("admin")));

  // 3. R2 (create if absent).
  if (!inspection.bucketExists) {
    const r2 = await wr.run(["r2", "bucket", "create", res]);
    if (!args.dryRun && !r2.ok)
      return fail(env, "could not create the R2 bucket", r2.stderr.trim());
  }

  // 4. Migrations (idempotent).
  const mig = await wr.run(["d1", "migrations", "apply", res, "--config", appCfg, "--remote"]);
  if (!args.dryRun && !mig.ok) return fail(env, "migrations failed", mig.stderr.trim());

  // 5. Seed app config — first init only (INSERT OR IGNORE never clobbers admin edits).
  const seedSql = buildSeedSql(effective);
  if (freshDb && seedSql !== null) {
    const seed = await wr.run([
      "d1",
      "execute",
      res,
      "--config",
      appCfg,
      "--remote",
      "--command",
      seedSql,
    ]);
    if (!args.dryRun && !seed.ok) return fail(env, "seeding app config failed", seed.stderr.trim());
  }

  // 6. Deploy both Workers; capture + validate the URLs.
  const appDeploy = await wr.run(["deploy", "--config", appCfg]);
  const adminDeploy = await wr.run(["deploy", "--config", adminCfg]);
  const appUrl = args.dryRun
    ? `https://${res}.<account>.workers.dev`
    : extractDeployUrl(appDeploy.stdout);
  const adminUrl = args.dryRun
    ? `https://${res}-admin.<account>.workers.dev`
    : extractDeployUrl(adminDeploy.stdout);
  if (appUrl === null || adminUrl === null) {
    return fail(
      env,
      "a Worker deployed but no URL was found in the output",
      "re-run; if it persists, check `wrangler deploy` output",
    );
  }
  state = { ...state, appUrl, adminUrl };

  // 7. Cloudflare Access. With creds → set them via --secrets-file (one deploy). Without → show the
  // manual dashboard step and WAIT, then collect the creds the operator now has.
  let teamDomain = effective.accessTeamDomain;
  let aud = effective.accessAud;
  if (accessManualNeeded(effective, inspection)) {
    env.out(
      renderManualStep(
        "Enable Cloudflare Access on the admin Worker, then come back:",
        [
          "Zero Trust → Access → Applications → Add (Self-hosted)",
          `Hostname: ${adminUrl.replace("https://", "")}`,
          "Add a policy allowing your email (one-time PIN)",
          "Copy the Application Audience (AUD) tag",
        ],
        env.palette,
      ),
    );
    if (!args.dryRun && !args.yes && env.interactive) {
      await env.prompt.waitForDone("Press Enter once Access is enabled and you have the AUD …");
      teamDomain = normalizeTeamDomain(await askNonEmpty(env.prompt, "Access team domain"));
      aud = await askNonEmpty(env.prompt, "Access AUD tag");
    }
  }
  if (teamDomain !== null && teamDomain !== "" && aud !== null && aud !== "") {
    const secretsFile = `${deployDir}/${args.instance}.secrets.json`;
    await env.fs.write(
      secretsFile,
      JSON.stringify({ ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud }),
    );
    const wired = await wr.run(["deploy", "--config", adminCfg, "--secrets-file", secretsFile]);
    await env.fs.remove(secretsFile);
    if (!args.dryRun && !wired.ok)
      return fail(env, "setting Access secrets failed", wired.stderr.trim());
  }

  // 8. Persist state (real runs only) and print the summary.
  if (!args.dryRun) await env.fs.write(statePath, serializeState(state));

  env.out("");
  env.out(env.palette.green("Deployed."));
  env.out(`  App   (public) → ${appUrl}`);
  env.out(`  Admin (gated)  → ${adminUrl}`);
  if (accessManualNeeded(effective, inspection) && (teamDomain === null || teamDomain === "")) {
    env.out(
      "  Access not wired — re-run with --access-team-domain/--access-aud once it's enabled.",
    );
  }
  env.out("  Publish your first build: see /admin/setup, or ./publish.sh");
  return 0;
}
