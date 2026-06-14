import { describe, expect, it } from "vitest";
import {
  accessConfigured,
  extractDeployUrl,
  parseD1Id,
  secretNames,
} from "../../src/deploy/core/parse";

describe("parseD1Id", () => {
  const list = JSON.stringify([
    { name: "other", uuid: "zzz" },
    { name: "alpha-gate-x", uuid: "abc-123" },
  ]);

  it("finds the uuid by database name", () => {
    expect(parseD1Id(list, "alpha-gate-x")).toBe("abc-123");
  });
  it("returns null when absent or output is garbled", () => {
    expect(parseD1Id(list, "missing")).toBeNull();
    expect(parseD1Id("not json", "x")).toBeNull();
    expect(parseD1Id("{}", "x")).toBeNull();
  });
});

describe("secretNames / accessConfigured", () => {
  const secrets = JSON.stringify([{ name: "ACCESS_TEAM_DOMAIN" }, { name: "ACCESS_AUD" }]);
  it("lists names and detects ACCESS_TEAM_DOMAIN", () => {
    expect(secretNames(secrets)).toEqual(["ACCESS_TEAM_DOMAIN", "ACCESS_AUD"]);
    expect(accessConfigured(secrets)).toBe(true);
    expect(accessConfigured("[]")).toBe(false);
    expect(accessConfigured("garbage")).toBe(false);
  });
});

describe("extractDeployUrl", () => {
  it("pulls the workers.dev URL out of deploy output", () => {
    const stdout =
      "Uploaded\nPublished alpha-gate-x\n  https://alpha-gate-x.acct.workers.dev\nDone";
    expect(extractDeployUrl(stdout)).toBe("https://alpha-gate-x.acct.workers.dev");
  });
  it("returns null when no URL is present (so the caller can fail loudly)", () => {
    expect(extractDeployUrl("no url here")).toBeNull();
  });
});
