import type { DeployArgs } from "./args";
import type { ApplyStep, Finding, InspectStep } from "./types";

// Pure planning: from the parsed args + what INSPECT learned, compute the read-only inspect commands,
// the findings to echo, and the APPLY steps (with skips). This is the brain the orchestration (#28)
// renders + executes; keeping it pure means idempotency and the skip logic are unit-tested with no I/O.

export interface Inspection {
  /** Existing D1 uuid, or null when it must be created. */
  d1Id: string | null;
  bucketExists: boolean;
  accessConfigured: boolean;
  /** Whether app config (meta.app_name) is already set — we don't reseed over admin edits. */
  seeded: boolean;
}

export function resourceName(instance: string): string {
  return `alpha-gate-${instance}`;
}

export function inspectSteps(args: DeployArgs): InspectStep[] {
  const res = resourceName(args.instance);
  return [
    { why: "account & login", command: "wrangler whoami" },
    { why: "database exists?", command: "wrangler d1 list --json" },
    { why: "bucket exists?", command: `wrangler r2 bucket info ${res}` },
    {
      why: "Access wired?",
      command: `wrangler secret list --config .deploy/${args.instance}.admin.toml --format json`,
    },
  ];
}

export function inspectionFindings(ins: Inspection): Finding[] {
  return [
    { label: "database", value: ins.d1Id ? `exists (${ins.d1Id.slice(0, 8)}…)` : "not found" },
    { label: "bucket", value: ins.bucketExists ? "exists" : "not found" },
    { label: "Access", value: ins.accessConfigured ? "configured" : "not configured" },
  ];
}

// The app-config values seeded into `meta` on a first init (only the ones actually provided).
const SEED_KEYS: ReadonlyArray<readonly [keyof DeployArgs, string]> = [
  ["appName", "app_name"],
  ["activateScheme", "activate_scheme"],
  ["blurb", "blurb"],
  ["accent", "accent"],
];

export function seedValues(args: DeployArgs): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const [argKey, metaKey] of SEED_KEYS) {
    const value = args[argKey];
    if (typeof value === "string" && value.length > 0) out.push({ key: metaKey, value });
  }
  return out;
}

/** The seed SQL (INSERT OR IGNORE — never clobbers admin edits), or null when there's nothing to seed. */
export function buildSeedSql(args: DeployArgs): string | null {
  const values = seedValues(args);
  if (values.length === 0) return null;
  return values
    .map(({ key, value }) => {
      const escaped = value.replace(/'/g, "''");
      return `INSERT OR IGNORE INTO meta (key, value) VALUES ('${key}', '${escaped}');`;
    })
    .join("");
}

/** True when the operator must enable Cloudflare Access by hand (no creds given, none configured yet). */
export function accessManualNeeded(args: DeployArgs, ins: Inspection): boolean {
  const haveCreds = args.accessTeamDomain !== null && args.accessAud !== null;
  return !haveCreds && !ins.accessConfigured;
}

export function buildApplyPlan(args: DeployArgs, ins: Inspection): ApplyStep[] {
  const res = resourceName(args.instance);
  const steps: ApplyStep[] = [];

  steps.push(
    ins.d1Id === null
      ? { kind: "create", what: "database", why: "", command: `wrangler d1 create ${res}` }
      : { kind: "skip", what: "database", why: "exists — skipping", command: "" },
  );
  steps.push(
    ins.bucketExists
      ? { kind: "skip", what: "bucket", why: "exists — skipping", command: "" }
      : { kind: "create", what: "bucket", why: "", command: `wrangler r2 bucket create ${res}` },
  );
  steps.push({
    kind: "update",
    what: "migrations",
    why: "",
    command: `wrangler d1 migrations apply ${res} --remote`,
  });

  const seeds = seedValues(args);
  if (ins.seeded || seeds.length === 0) {
    steps.push({
      kind: "skip",
      what: "app config",
      why: ins.seeded ? "already set — skipping" : "nothing to seed",
      command: "",
    });
  } else {
    steps.push({
      kind: "create",
      what: "app config",
      why: "",
      command: `wrangler d1 execute ${res} --remote  (seed: ${seeds.map((s) => s.key).join(", ")})`,
    });
  }

  steps.push({
    kind: "update",
    what: "deploy app",
    why: "",
    command: `wrangler deploy -c .deploy/${args.instance}.app.toml`,
  });
  steps.push({
    kind: "update",
    what: "deploy admin",
    why: "",
    command: `wrangler deploy -c .deploy/${args.instance}.admin.toml`,
  });

  if (args.accessTeamDomain !== null && args.accessAud !== null) {
    steps.push({
      kind: "update",
      what: "Access secrets",
      why: "",
      command: "wrangler deploy admin --secrets-file (ACCESS_TEAM_DOMAIN, ACCESS_AUD)",
    });
  }

  return steps;
}
