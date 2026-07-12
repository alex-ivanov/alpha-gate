import { describe, expect, it } from "vitest";
import {
  type DeployState,
  emptyState,
  parseState,
  serializeState,
} from "../../src/deploy/core/state";

describe("state ledger", () => {
  it("serializes to deploy.sh's snake_case keys (publish.sh compatibility) + remembered inputs", () => {
    const s: DeployState = {
      instance: "x",
      d1Id: "uuid",
      appUrl: "https://app",
      adminUrl: "https://admin",
      emailProvider: "cloudflare",
      emailFrom: "a@b.dev",
      accessTeamDomain: "t.cloudflareaccess.com",
      accessAud: "abc",
    };
    const json = JSON.parse(serializeState(s));
    expect(json).toMatchObject({
      instance: "x",
      app_url: "https://app",
      admin_url: "https://admin",
      d1_id: "uuid",
      email_provider: "cloudflare",
      email_from: "a@b.dev",
      access_team_domain: "t.cloudflareaccess.com",
      access_aud: "abc",
    });
  });

  it("remembers email + access inputs across a round-trip (bare re-run keeps them)", () => {
    const s = { ...emptyState("x"), emailProvider: "cloudflare", emailFrom: "a@b.dev" };
    expect(parseState(serializeState(s), "x").emailProvider).toBe("cloudflare");
    expect(parseState(serializeState(s), "x").emailFrom).toBe("a@b.dev");
  });

  it("round-trips through serialize/parse", () => {
    const s = { ...emptyState("x"), adminUrl: "https://a", d1Id: "uuid" };
    expect(parseState(serializeState(s), "x")).toEqual(s);
  });

  it("is tolerant: corrupt/missing JSON and unknown keys yield a clean state", () => {
    expect(parseState("not json", "x")).toEqual(emptyState("x"));
    expect(parseState("{}", "x").instance).toBe("x");
    // older versions wrote a `phases` array — it is simply ignored now
    expect(parseState('{"phases":["d1"],"admin_url":"https://a"}', "x").adminUrl).toBe("https://a");
  });
});
