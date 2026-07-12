import { describe, expect, it } from "vitest";
import { type ConfigVars, renderConfig } from "../../src/deploy/core/config";

const BASE: ConfigVars = {
  instance: "myalpha",
  d1Id: "uuid-123",
  role: "app",
  name: "alpha-gate-myalpha",
  emailProvider: "none",
  emailFrom: "",
  toolVersion: "0.1.0",
  updateManifestUrl: "https://example.test/release.json",
  main: "/pkg/src/worker.ts",
  migrationsDir: "/pkg/migrations",
};

describe("renderConfig", () => {
  it("renders the shared bindings, vars, absolute main + migrations_dir, and cron", () => {
    const out = renderConfig(BASE);
    expect(out).toContain('name = "alpha-gate-myalpha"');
    expect(out).toContain('main = "/pkg/src/worker.ts"'); // absolute → resolves from any config location
    expect(out).toContain("[[d1_databases]]");
    expect(out).toContain('database_name = "alpha-gate-myalpha"');
    expect(out).toContain('database_id = "uuid-123"');
    expect(out).toContain('migrations_dir = "/pkg/migrations"');
    expect(out).toContain("[[r2_buckets]]");
    expect(out).toContain('INSTANCE = "myalpha"');
    expect(out).toContain('ROLE = "app"');
    expect(out).toContain('crons = ["0 12 * * *"]');
  });

  it("omits the send_email binding on the app Worker", () => {
    expect(renderConfig({ ...BASE, role: "app", emailProvider: "cloudflare" })).not.toContain(
      "send_email",
    );
  });

  it("omits send_email on the admin Worker when email is off", () => {
    expect(renderConfig({ ...BASE, role: "admin", emailProvider: "none" })).not.toContain(
      "send_email",
    );
  });

  it("includes send_email only on the admin Worker with cloudflare email", () => {
    const out = renderConfig({ ...BASE, role: "admin", emailProvider: "cloudflare" });
    expect(out).toContain("[[send_email]]");
    expect(out).toContain('name = "EMAIL"');
  });

  it("escapes quotes/backslashes in string values (no TOML break)", () => {
    const out = renderConfig({ ...BASE, name: 'weird"name', emailFrom: "a\\b" });
    expect(out).toContain('name = "weird\\"name"');
    expect(out).toContain('EMAIL_FROM = "a\\\\b"');
  });
});
