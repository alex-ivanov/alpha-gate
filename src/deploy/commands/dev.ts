import { parseDevArgs } from "../core/args";
import type { Palette } from "../core/colors";
import { bundleFlags, renderConfig } from "../core/config";
import { resourceName } from "../core/plan";
import { renderHeader } from "../core/ui";
import type { FileSystem } from "../seams/files";
import type { Wrangler } from "../seams/wrangler";

// The `dev` command (§23 local surface): run a Worker locally on Miniflare (no Cloudflare account).
// Renders a local wrangler config, applies migrations to a LOCAL D1, optionally seeds a demo
// client/build, then hands off to `wrangler dev`. The admin role points main at the dev-only entry
// (src/dev/admin-entry.ts) + DEV_ADMIN=1 so the gated UI is browser-usable on localhost.

export interface DevEnv {
  wrangler: Wrangler;
  fs: FileSystem;
  palette: Palette;
  out: (line: string) => void;
  /** The PACKAGE root — only for paths that must point INTO the package (`main`, migrations, tsconfig). */
  rootDir: string;
  /** Where everything DURABLE goes (core/paths): `<repo>/.deploy` for a checkout, `~/.alpha-gate` for
      an npm install. Never `rootDir` — under npx that is a versioned, prunable cache directory. */
  stateDir: string;
  toolVersion: string;
  updateManifestUrl: string;
  /** Probe whether something already listens on a TCP port (injected; real net check in cli.ts). */
  portInUse?: (port: number) => Promise<boolean>;
}

const INSTANCE = "local";
const DEMO_TOKEN = "DEV0DEV0DEV0DEV0DEV0DEV0DEV0DEV0"; // valid Crockford base32 (no I/L/O/U)

function fail(env: DevEnv, reason: string, hint: string): number {
  env.out(env.palette.red(`dev: ${reason}`));
  if (hint) env.out(`  → ${hint}`);
  return 1;
}

export async function runDev(argv: readonly string[], env: DevEnv): Promise<number> {
  const parsed = parseDevArgs(argv);
  if (!parsed.ok) return fail(env, parsed.error, parsed.hint ?? "");
  const args = parsed.value;

  const res = resourceName(INSTANCE); // alpha-gate-local
  // Durable local-dev state belongs in the resolved state dir, NOT in the package. `deploy` and
  // `teardown` already do this; `dev` used to write into `rootDir`, which from an npm install is
  // node_modules — so the local D1/R2 vanished the moment npx resolved a newer version into a
  // different cache hash, and a root-owned global install couldn't even mkdir it. For a git checkout
  // both resolve to `<repo>/.deploy`, so nothing moves for contributors except the Miniflare state,
  // which is throwaway by design (`--reset` exists precisely because it is).
  const deployDir = env.stateDir;
  const stateDir = `${env.stateDir}/local-state`; // Miniflare's D1/R2; shared by both roles
  const cfg = `${deployDir}/${INSTANCE}.${args.role}.toml`;
  const wr = env.wrangler;

  env.out(renderHeader(`${INSTANCE} (${args.role})`, env.palette));

  // Fail fast if the port is already taken. wrangler 4.x does NOT report EADDRINUSE — it prints
  // "Ready on http://localhost:PORT" while a stale/orphaned listener actually owns the port, so the
  // browser hits a dead server. An orphaned workerd from a prior Ctrl-C'd run is the usual cause.
  if (env.portInUse && (await env.portInUse(args.port))) {
    return fail(
      env,
      `port ${args.port} is already in use`,
      `another dev server or an orphaned workerd holds it — free it (pkill -f workerd) or use --port N`,
    );
  }

  if (args.reset) {
    await env.fs.remove(stateDir);
    env.out(env.palette.dim("  reset local D1/R2 state"));
  }

  // Render the local config. The admin role uses the dev-only entry so its gated UI opens on localhost.
  await env.fs.mkdirp(deployDir);
  await env.fs.write(
    cfg,
    renderConfig({
      instance: INSTANCE,
      d1Id: "local", // ignored by `wrangler dev --local`
      role: args.role,
      name: args.role === "admin" ? `${res}-admin` : res,
      emailProvider: "none",
      emailFrom: "",
      toolVersion: env.toolVersion,
      updateManifestUrl: env.updateManifestUrl,
      main:
        args.role === "admin"
          ? `${env.rootDir}/src/dev/admin-entry.ts`
          : `${env.rootDir}/src/worker.ts`,
      migrationsDir: `${env.rootDir}/migrations`,
    }),
  );

  // Migrations + seed use the captured run() (NOT exec): these are short `npx wrangler` commands, and
  // spawning npx with inherited stdio from inside this npx/tsx process deadlocks on npm's lock — only
  // the final, long-running `wrangler dev` gets inherited stdio. We print a progress line before each
  // step (so a slow/blocked step isn't a silent hang) and surface wrangler's stderr on failure.
  env.out(env.palette.dim("  → applying migrations to the local database…"));
  const mig = await wr.run([
    "d1",
    "migrations",
    "apply",
    res,
    "--config",
    cfg,
    "--local",
    "--persist-to",
    stateDir,
  ]);
  if (!mig.ok) {
    if (mig.stderr.trim()) env.out(mig.stderr.trim());
    return fail(
      env,
      "local migrations failed",
      "retry with --reset (a stuck local state can block it)",
    );
  }

  // Seed a demo world (idempotent) so /get, /appcast, /download return real data. Best-effort: a seed
  // failure is reported but does not stop the server (the schema is already migrated).
  if (args.seed) {
    env.out(env.palette.dim("  → seeding a demo client + build…"));
    const archive = `${deployDir}/${INSTANCE}-dev-archive.zip`;
    await env.fs.write(archive, "ALPHA-GATE-DEV-ARCHIVE");
    const put = await wr.run([
      "r2",
      "object",
      "put",
      `${res}/build/1000/App.zip`,
      "--file",
      archive,
      "--content-type",
      "application/zip",
      "--local",
      "--persist-to",
      stateDir,
    ]);
    if (!put.ok && put.stderr.trim()) {
      env.out(env.palette.yellow(`  seed (r2) skipped: ${put.stderr.trim()}`));
    }
    const sql = [
      "INSERT OR IGNORE INTO streams (name) VALUES ('local');",
      `INSERT OR IGNORE INTO clients (email, token, status) VALUES ('dev@example.test', '${DEMO_TOKEN}', 'active');`,
      "INSERT OR IGNORE INTO builds (short_version, build_number, object_key, ed_signature, length, status)" +
        " VALUES ('1.0.0-dev', 1000, 'build/1000/App.zip', 'DEVSIG==', 22, 'available');",
      "INSERT OR IGNORE INTO build_streams (build_id, stream_id)" +
        " SELECT b.id, s.id FROM builds b JOIN streams s ON s.name='local' WHERE b.build_number=1000;",
      "INSERT OR IGNORE INTO user_streams (client_id, stream_id)" +
        " SELECT c.id, s.id FROM clients c JOIN streams s ON s.name='local' WHERE c.email='dev@example.test';",
    ].join("");
    const seeded = await wr.run([
      "d1",
      "execute",
      res,
      "--config",
      cfg,
      "--local",
      "--persist-to",
      stateDir,
      "--command",
      sql,
    ]);
    if (!seeded.ok && seeded.stderr.trim()) {
      env.out(env.palette.yellow(`  seed (d1) skipped: ${seeded.stderr.trim()}`));
    }
  }

  const base = `http://localhost:${args.port}`;
  env.out("");
  if (args.role === "app") {
    env.out(env.palette.green(`App Worker → ${base}`));
    if (args.seed) env.out(`  ${base}/get?token=${DEMO_TOKEN}`);
  } else {
    env.out(env.palette.green(`Admin Worker → ${base}/admin`));
    env.out(
      env.palette.yellow(
        "  LOCAL-DEV auth shim — every request is admin 'dev@local'. localhost only.",
      ),
    );
  }
  env.out(env.palette.dim("  Ctrl-C to stop."));
  env.out(
    env.palette.dim("  → starting wrangler dev (the first run downloads the workerd runtime)…"),
  );
  env.out("");

  const devArgs = [
    "dev",
    "--config",
    cfg,
    "--port",
    String(args.port),
    "--local",
    "--persist-to",
    stateDir,
    ...bundleFlags(env.rootDir),
  ];
  if (args.role === "admin") devArgs.push("--var", "DEV_ADMIN:1");
  return wr.exec(devArgs);
}
