import type { Role } from "./types";

// Renders a Worker's wrangler.toml in TS — replaces the old envsubst-over-a-template step (decision
// 0009). Building it directly (not string-substituting an external template) means there's no
// "unsubstituted ${VAR}" failure mode, values are escaped, and the output is unit-tested. This function
// is the single source of truth for the rendered wrangler config shape.

export interface ConfigVars {
  instance: string;
  d1Id: string;
  role: Role;
  name: string;
  emailProvider: "none" | "cloudflare";
  emailFrom: string;
  toolVersion: string;
  updateManifestUrl: string;
  /** Worker entry, relative to the rendered config's directory (.deploy/). */
  main: string;
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
    // Resolved relative to this config file (.deploy/) so `wrangler d1 migrations apply` finds ./migrations.
    `migrations_dir = "../migrations"`,
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
