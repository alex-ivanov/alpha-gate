import { describe, expect, it } from "vitest";
import { type DeployArgs, parseDeployArgs } from "../../src/deploy/core/args";
import {
  accessManualNeeded,
  buildApplyPlan,
  buildSeedSql,
  type Inspection,
  inspectSteps,
  resourceName,
  seedValues,
} from "../../src/deploy/core/plan";

function args(extra: string[] = []): DeployArgs {
  const r = parseDeployArgs(["--instance", "x", ...extra]);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const FRESH: Inspection = {
  d1Id: null,
  bucketExists: false,
  accessConfigured: false,
  seeded: false,
};
const EXISTING: Inspection = {
  d1Id: "uuid-1234abcd",
  bucketExists: true,
  accessConfigured: true,
  seeded: true,
};

describe("inspectSteps", () => {
  it("lists the four read-only checks with exact commands", () => {
    const cmds = inspectSteps(args()).map((s) => s.command);
    expect(cmds).toContain("wrangler whoami");
    expect(cmds).toContain("wrangler r2 bucket info alpha-gate-x");
  });
});

describe("buildApplyPlan", () => {
  it("on a fresh instance, creates db + bucket and seeds (with values)", () => {
    const steps = buildApplyPlan(args(["--app-name", "Acme"]), FRESH);
    const byWhat = Object.fromEntries(steps.map((s) => [s.what, s.kind]));
    expect(byWhat.database).toBe("create");
    expect(byWhat.bucket).toBe("create");
    expect(byWhat["app config"]).toBe("create");
    expect(byWhat.migrations).toBe("update");
    expect(byWhat["deploy app"]).toBe("update");
  });

  it("on a re-run, skips existing db/bucket and skips seeding", () => {
    const steps = buildApplyPlan(args(["--app-name", "Acme"]), EXISTING);
    const byWhat = Object.fromEntries(steps.map((s) => [s.what, s.kind]));
    expect(byWhat.database).toBe("skip");
    expect(byWhat.bucket).toBe("skip");
    expect(byWhat["app config"]).toBe("skip");
  });

  it("skips seeding on a fresh db when no app config values were given", () => {
    const step = buildApplyPlan(args(), FRESH).find((s) => s.what === "app config");
    expect(step?.kind).toBe("skip");
    expect(step?.why).toContain("nothing to seed");
  });

  it("adds an Access-secrets step only when creds are provided", () => {
    const without = buildApplyPlan(args(), FRESH).some((s) => s.what === "Access secrets");
    const withCreds = buildApplyPlan(
      args(["--access-team-domain", "t.cloudflareaccess.com", "--access-aud", "AUD"]),
      FRESH,
    ).some((s) => s.what === "Access secrets");
    expect(without).toBe(false);
    expect(withCreds).toBe(true);
  });
});

describe("accessManualNeeded", () => {
  it("true when no creds and not yet configured; false otherwise", () => {
    expect(accessManualNeeded(args(), FRESH)).toBe(true);
    expect(accessManualNeeded(args(), { ...FRESH, accessConfigured: true })).toBe(false);
    expect(
      accessManualNeeded(
        args(["--access-team-domain", "t.cloudflareaccess.com", "--access-aud", "AUD"]),
        FRESH,
      ),
    ).toBe(false);
  });
});

describe("seed sql", () => {
  it("includes only provided values and escapes single quotes", () => {
    const a = args(["--app-name", "Bob's App", "--activate-scheme", "acme"]);
    expect(seedValues(a).map((v) => v.key)).toEqual(["app_name", "activate_scheme"]);
    const sql = buildSeedSql(a);
    expect(sql).toContain("INSERT OR IGNORE INTO meta");
    expect(sql).toContain("'Bob''s App'");
    expect(sql).toContain("'app_name'");
  });

  it("returns null when there's nothing to seed", () => {
    expect(buildSeedSql(args())).toBeNull();
  });
});

describe("resourceName", () => {
  it("namespaces by instance", () => {
    expect(resourceName("myalpha")).toBe("alpha-gate-myalpha");
  });
});
