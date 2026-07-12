import { describe, expect, it } from "vitest";
import { resolveStateDir } from "../../src/deploy/core/paths";

describe("resolveStateDir", () => {
  const base = {
    packageRoot: "/pkg",
    home: undefined,
    userHome: "/Users/alex",
    isGitCheckout: false,
  };

  it("a git checkout keeps state at <root>/.deploy (backward compatible)", () => {
    expect(resolveStateDir({ ...base, isGitCheckout: true })).toBe("/pkg/.deploy");
  });

  it("an npm install puts state in ~/.alpha-gate (survives npx cache churn)", () => {
    expect(resolveStateDir({ ...base, isGitCheckout: false })).toBe("/Users/alex/.alpha-gate");
  });

  it("$ALPHA_GATE_HOME overrides both modes", () => {
    expect(resolveStateDir({ ...base, home: "/custom", isGitCheckout: true })).toBe("/custom");
    expect(resolveStateDir({ ...base, home: "/custom", isGitCheckout: false })).toBe("/custom");
  });

  it("falls back to a relative dir when HOME is unknown", () => {
    expect(resolveStateDir({ ...base, userHome: undefined })).toBe("./.alpha-gate");
  });
});
