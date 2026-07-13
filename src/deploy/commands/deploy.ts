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
  /** The PACKAGE root — where src/ and migrations/ live (the repo, or the npm install dir). */
  rootDir: string;
  /** Where per-instance state (.deploy configs + state.json) is written — `<root>/.deploy` for a
      checkout, `~/.alpha-gate` for an npm install (see core/paths). */
  stateDir: string;
  toolVersion: string;
  updateManifestUrl: string;
  nodeMajor: number;
  /** Whether stdin is a TTY — gates interactive prompts (the manual-Access wait + first-init branding). */
  interactive: boolean;
  /** Probes the admin URL for Cloudflare Access (confirms enabled + derives the team domain). */
  probeAccess?:
    | ((adminUrl: string) => Promise<{ enabled: boolean; teamDomain: string | null }>)
    | undefined;
}

// An Access AUD tag is a 32–64 char hex string. Catch a fat-fingered paste here rather than as a
// mystery 403 days later.
function looksLikeAud(value: string): boolean {
  return /^[0-9a-f]{32,64}$/i.test(value.trim());
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
  const deployDir = env.stateDir;
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

  // Load prior state up front so a bare re-run reuses remembered inputs. `deploy --instance X` with no
  // --email-provider must NOT silently turn email off, and no --access-* must not drop the Access
  // wiring — the #1 "it broke on the next deploy" surprise. Explicit flags always win.
  await env.fs.mkdirp(deployDir);
  const statePath = `${deployDir}/${args.instance}.state.json`;
  let state = parseState((await env.fs.read(statePath)) ?? "", args.instance);

  // First-init branding (parity with the old deploy.sh): on a fresh instance + an interactive TTY,
  // prompt for anything not passed as a flag, so /get + the activate link are correct immediately. The
  // values are seeded with INSERT OR IGNORE, so the admin Settings page owns them thereafter.
  let effective = {
    ...args,
    // Remembered email/access default the args when the flags are absent (flags still override).
    emailProvider: (args.emailProvider === "none" && state.emailProvider !== null
      ? state.emailProvider
      : args.emailProvider) as typeof args.emailProvider,
    emailFrom: args.emailFrom ?? state.emailFrom,
    accessTeamDomain: args.accessTeamDomain ?? state.accessTeamDomain,
    accessAud: args.accessAud ?? state.accessAud,
  };
  if (
    state.emailProvider !== null &&
    args.emailProvider === "none" &&
    state.emailProvider !== "none"
  ) {
    env.out(env.palette.dim(`  (reusing email: ${state.emailProvider} ${state.emailFrom ?? ""})`));
  }
  if (freshDb && env.interactive && !args.yes && !args.dryRun) {
    effective = {
      ...effective,
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

  // Remember the effective email settings so the next bare re-run keeps them.
  state = {
    ...state,
    emailProvider: effective.emailProvider,
    emailFrom: effective.emailFrom,
  };

  // Live progress: a dim "→ …" as each step starts, a green "✓" (with the deploy URL) when it lands.
  // Failures print via fail() instead. Skipped steps were already shown in the plan above.
  env.out("");
  env.out(env.palette.bold("Applying…"));
  const startStep = (label: string): void => env.out(env.palette.dim(`  → ${label}…`));
  const doneStep = (label: string, extra = ""): void =>
    env.out(env.palette.green(`  ✓ ${label}${extra === "" ? "" : `  ${extra}`}`));

  // 1. D1 (create if absent, then resolve its id).
  let d1Id = inspection.d1Id;
  if (d1Id === null) {
    startStep("create database");
    const created = await wr.run(["d1", "create", res]);
    if (!args.dryRun && !created.ok) {
      return fail(env, "could not create the D1 database", created.stderr.trim());
    }
    d1Id = args.dryRun
      ? "dry-run-d1-id"
      : parseD1Id((await wr.run(["d1", "list", "--json"])).stdout, res);
    if (d1Id === null) {
      return fail(env, "D1 created but no id was returned", "check your account quota");
    }
    doneStep("database");
  }
  const databaseId: string = d1Id;
  state = { ...state, d1Id: databaseId };

  // 2. Render both configs (needs the resolved d1Id; written before migrate/deploy use --config).
  const configVars = (role: Role): ConfigVars => ({
    instance: args.instance,
    d1Id: databaseId,
    role,
    name: role === "admin" ? `${res}-admin` : res,
    emailProvider: effective.emailProvider,
    emailFrom: effective.emailFrom ?? "",
    toolVersion: env.toolVersion,
    updateManifestUrl: env.updateManifestUrl,
    // Absolute paths into the package, so the rendered config resolves them whether it lives in the
    // repo `.deploy/` or the relocated `~/.alpha-gate` (which isn't a sibling of src/migrations).
    main: `${env.rootDir}/src/worker.ts`,
    migrationsDir: `${env.rootDir}/migrations`,
  });
  if (!args.dryRun) {
    await env.fs.write(appCfg, renderConfig(configVars("app")));
    await env.fs.write(adminCfg, renderConfig(configVars("admin")));
  }

  // 3. R2 (create if absent).
  if (!inspection.bucketExists) {
    startStep("create bucket");
    const r2 = await wr.run(["r2", "bucket", "create", res]);
    if (!args.dryRun && !r2.ok)
      return fail(env, "could not create the R2 bucket", r2.stderr.trim());
    doneStep("bucket");
  }

  // 4. Migrations (idempotent).
  startStep("apply migrations");
  const mig = await wr.run(["d1", "migrations", "apply", res, "--config", appCfg, "--remote"]);
  if (!args.dryRun && !mig.ok) return fail(env, "migrations failed", mig.stderr.trim());
  doneStep("migrations");

  // 5. Seed app config — first init only (INSERT OR IGNORE never clobbers admin edits).
  const seedSql = buildSeedSql(effective);
  if (freshDb && seedSql !== null) {
    startStep("seed app config");
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
    doneStep("app config");
  }

  // 6. Deploy both Workers; capture + validate each URL.
  startStep("deploy app Worker");
  const appDeploy = await wr.run(["deploy", "--config", appCfg]);
  const appUrl = args.dryRun
    ? `https://${res}.<account>.workers.dev`
    : extractDeployUrl(appDeploy.stdout);
  if (appUrl === null) {
    return fail(
      env,
      "the app Worker deployed but no URL was found",
      "check `wrangler deploy` output",
    );
  }
  doneStep("app Worker", appUrl);

  startStep("deploy admin Worker");
  const adminDeploy = await wr.run(["deploy", "--config", adminCfg]);
  const adminUrl = args.dryRun
    ? `https://${res}-admin.<account>.workers.dev`
    : extractDeployUrl(adminDeploy.stdout);
  if (adminUrl === null) {
    return fail(
      env,
      "the admin Worker deployed but no URL was found",
      "check `wrangler deploy` output",
    );
  }
  doneStep("admin Worker", adminUrl);
  state = { ...state, appUrl, adminUrl };

  // 7. Cloudflare Access. With creds → set them via --secrets-file (one deploy). Without → show the
  // manual dashboard step, WAIT, then POLL the admin URL: enabling Access makes it redirect to the
  // team's login, which both confirms it's really on and hands us the team domain — so the operator
  // copies only the AUD, and a "pressed Enter but didn't enable it" mistake is caught here, not later.
  let teamDomain = effective.accessTeamDomain;
  let aud = effective.accessAud;
  if (accessManualNeeded(effective, inspection)) {
    // One instruction set, matching docs/setup/deploy.md §4 (the easy path — Cloudflare fills the hostname).
    env.out(
      renderManualStep(
        "Enable Cloudflare Access on the admin Worker, then come back:",
        [
          "Cloudflare dashboard → Workers & Pages → the -admin Worker",
          "Settings → Domains & Routes → enable Cloudflare Access",
          "Edit the policy: Allow → your email (identity: One-time PIN)",
          "Copy the Application Audience (AUD): Access → Applications → your app → Overview",
        ],
        env.palette,
      ),
    );
    if (!args.dryRun && !args.yes && env.interactive) {
      await env.prompt.waitForDone("Press Enter once Access is enabled and you have the AUD …");
      // Confirm it's on and derive the team domain from the redirect.
      const probe = env.probeAccess ? await env.probeAccess(adminUrl) : null;
      if (probe && !probe.enabled) {
        env.out(
          env.palette.yellow(
            "  Access doesn't seem enabled yet — the admin URL isn't redirecting to a login.",
          ),
        );
      }
      if (probe?.teamDomain) {
        teamDomain = probe.teamDomain;
        env.out(env.palette.green(`  ✓ detected team domain: ${teamDomain}`));
      } else {
        teamDomain = normalizeTeamDomain(await askNonEmpty(env.prompt, "Access team domain"));
      }
      // Only the AUD is hand-copied; sanity-check its shape and warn on an obvious typo (the admin's
      // reason-bearing 403 catches a genuinely wrong one, so we accept rather than block).
      aud = (await askNonEmpty(env.prompt, "Access AUD tag")).trim();
      if (!looksLikeAud(aud)) {
        env.out(
          env.palette.yellow("  Heads up: that doesn't look like an AUD (expect 32–64 hex)."),
        );
      }
    }
  }
  // Remember the wired Access values so a later bare re-run keeps them.
  state = { ...state, accessTeamDomain: teamDomain, accessAud: aud };
  if (teamDomain !== null && teamDomain !== "" && aud !== null && aud !== "") {
    startStep("wire Cloudflare Access");
    const secretsFile = `${deployDir}/${args.instance}.secrets.json`;
    if (!args.dryRun) {
      await env.fs.write(
        secretsFile,
        JSON.stringify({ ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud }),
      );
    }
    const wired = await wr.run(["deploy", "--config", adminCfg, "--secrets-file", secretsFile]);
    if (!args.dryRun) await env.fs.remove(secretsFile);
    if (!args.dryRun && !wired.ok)
      return fail(env, "setting Access secrets failed", wired.stderr.trim());
    doneStep("Access");
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
  env.out(
    "  Publish your first build: ./publish.sh MyApp.dmg --channel <name>  (see /admin/setup)",
  );
  env.out(
    env.palette.dim(
      "  Publishing from CI? Create an Access service token + Service-Auth policy — see /admin/ci.",
    ),
  );
  return 0;
}
