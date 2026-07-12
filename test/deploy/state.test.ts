import { describe, expect, it } from "vitest";
import {
  type DeployState,
  emptyState,
  hasPhase,
  parseState,
  serializeState,
  withPhase,
} from "../../src/deploy/core/state";

describe("state ledger", () => {
  it("withPhase marks a phase done (idempotent) and hasPhase reads it", () => {
    let s = emptyState("x");
    expect(hasPhase(s, "d1")).toBe(false);
    s = withPhase(s, "d1");
    s = withPhase(s, "d1"); // idempotent
    expect(hasPhase(s, "d1")).toBe(true);
    expect(s.done).toEqual(["d1"]);
  });

  it("serializes to deploy.sh's snake_case keys (publish.sh compatibility) + remembered inputs", () => {
    const s: DeployState = {
      instance: "x",
      d1Id: "uuid",
      appUrl: "https://app",
      adminUrl: "https://admin",
      done: ["d1", "migrate"],
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
      phases: ["d1", "migrate"],
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
    const s = withPhase(withPhase({ ...emptyState("x"), adminUrl: "https://a" }, "d1"), "r2");
    expect(parseState(serializeState(s), "x")).toEqual(s);
  });

  it("is tolerant: corrupt/missing JSON yields an empty state for the instance", () => {
    expect(parseState("not json", "x")).toEqual(emptyState("x"));
    expect(parseState("{}", "x").instance).toBe("x");
    expect(parseState('{"phases":["d1","bogus"]}', "x").done).toEqual(["d1"]); // unknown phase dropped
  });
});
