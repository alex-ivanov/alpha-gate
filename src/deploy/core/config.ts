import type { Role } from "./types";

// Renders a Worker's wrangler.toml in TS — replaces the old envsubst-over-a-template step (decision
// 0009). Building it directly (not string-substituting an external template) means there's no
// "unsubstituted ${VAR}" failure mode, values are escaped, and the output is unit-tested. This function
// is the single source of truth for the rendered wrangler config shape.

// Flags every wrangler command that BUNDLES the Worker must carry (`deploy`, `dev` — not `d1`/`r2`/
// `secret`, which never touch the source).
//
// Why this exists: esbuild (inside wrangler) finds a tsconfig by walking up from the entry file, but it
// SKIPS any tsconfig.json that lives inside `node_modules`. From a git checkout that walk-up finds our
// tsconfig and the JSX transform is right. From an npm/npx install the package sits under node_modules,
// the tsconfig is ignored, esbuild silently falls back to the CLASSIC JSX transform, and every view
// compiles to `React.createElement` — a Worker that deploys clean and then throws
// "ReferenceError: React is not defined" on the first request. Passing the path explicitly makes the
// transform independent of where the package happens to live. Also pinned: `main` in the rendered config
// is absolute for the same reason (the config does not sit next to src/).
export function bundleFlags(rootDir: string): string[] {
  return ["--tsconfig", `${rootDir}/tsconfig.json`];
}

export interface ConfigVars {
  instance: string;
  d1Id: string;
  role: Role;
  name: string;
  emailProvider: "none" | "cloudflare";
  emailFrom: string;
  toolVersion: string;
  updateManifestUrl: string;
  /** Worker entry — an ABSOLUTE path into the package src, so the config resolves it wherever the
      rendered .toml lives (repo `.deploy/`, or `~/.alpha-gate` for an npm install). */
  main: string;
  /** ABSOLUTE path to the migrations dir (same reason as `main`). */
  migrationsDir: string;
}

function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function renderConfig(v: ConfigVars): string {
  const q = (s: string): string => `"${tomlString(s)}"`;
  const lines: string[] = [
    `name = ${q(v.name)}`,
    `main = ${q(v.main)}`,
    `compatibility_date = "2025-01-01"`,
    `workers_dev = true`,
    "",
    "[[d1_databases]]",
    `binding = "DB"`,
    `database_name = ${q(`alpha-gate-${v.instance}`)}`,
    `database_id = ${q(v.d1Id)}`,
    // Absolute path into the package, so `wrangler d1 migrations apply` finds it no matter where the
    // rendered config lives (repo `.deploy/` or the relocated `~/.alpha-gate`).
    `migrations_dir = ${q(v.migrationsDir)}`,
    "",
    "[[r2_buckets]]",
    `binding = "BUILDS"`,
    `bucket_name = ${q(`alpha-gate-${v.instance}`)}`,
    "",
    "[vars]",
    `INSTANCE = ${q(v.instance)}`,
    `ROLE = ${q(v.role)}`,
    `EMAIL_PROVIDER = ${q(v.emailProvider)}`,
    `EMAIL_FROM = ${q(v.emailFrom)}`,
    `TOOL_VERSION = ${q(v.toolVersion)}`,
    `UPDATE_MANIFEST_URL = ${q(v.updateManifestUrl)}`,
  ];

  // The Cloudflare Email Service binding goes on the ADMIN Worker only, and only when email is on —
  // the public app Worker never sends mail, so it must not carry the binding.
  if (v.role === "admin" && v.emailProvider === "cloudflare") {
    lines.push("", "[[send_email]]", `name = "EMAIL"`);
  }

  lines.push("", "[triggers]", `crons = ["0 12 * * *"]`, "");
  return lines.join("\n");
}
