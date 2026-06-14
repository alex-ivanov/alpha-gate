import { describe, expect, it } from "vitest";
import { normalizeTeamDomain, parseDeployArgs } from "../../src/deploy/core/args";

function parse(args: string) {
  return parseDeployArgs(args.split(" ").filter(Boolean));
}

describe("parseDeployArgs", () => {
  it("parses a minimal valid invocation", () => {
    const r = parse("--instance myalpha");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.instance).toBe("myalpha");
      expect(r.value.emailProvider).toBe("none");
      expect(r.value.dryRun).toBe(false);
    }
  });

  it("requires --instance", () => {
    const r = parse("--dry-run");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("--instance is required");
  });

  it.each([
    "Bad_Name",
    "-lead",
    "trail-",
    "UPPER",
    "has space",
  ])("rejects invalid slug %s", (slug) => {
    expect(parseDeployArgs(["--instance", slug]).ok).toBe(false);
  });

  it("accepts boolean flags and value flags", () => {
    const r = parse("--instance x --app-name Acme --activate-scheme acme --dry-run --yes");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.appName).toBe("Acme");
      expect(r.value.activateScheme).toBe("acme");
      expect(r.value.dryRun).toBe(true);
      expect(r.value.yes).toBe(true);
    }
  });

  it("requires --email-from when provider is cloudflare", () => {
    expect(parse("--instance x --email-provider cloudflare").ok).toBe(false);
    expect(parse("--instance x --email-provider cloudflare --email-from a@b.test").ok).toBe(true);
  });

  it("rejects an invalid email provider", () => {
    expect(parse("--instance x --email-provider sendgrid").ok).toBe(false);
  });

  it("requires the Access pair together and normalizes the team domain", () => {
    expect(parse("--instance x --access-team-domain t.cloudflareaccess.com").ok).toBe(false);
    const r = parseDeployArgs([
      "--instance",
      "x",
      "--access-team-domain",
      "https://t.cloudflareaccess.com/",
      "--access-aud",
      "AUD",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.accessTeamDomain).toBe("t.cloudflareaccess.com");
  });

  it("rejects unknown flags and value flags missing a value", () => {
    expect(parse("--instance x --bogus").ok).toBe(false);
    expect(parseDeployArgs(["--instance"]).ok).toBe(false);
  });
});

describe("normalizeTeamDomain", () => {
  it("strips scheme and trailing slash", () => {
    expect(normalizeTeamDomain("https://team.cloudflareaccess.com/")).toBe(
      "team.cloudflareaccess.com",
    );
    expect(normalizeTeamDomain("team.cloudflareaccess.com")).toBe("team.cloudflareaccess.com");
  });
});
