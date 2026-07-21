import { describe, expect, it } from "vitest";
import { resolveStateDir, resolveUserPath } from "../../src/deploy/core/paths";

describe("resolveUserPath", () => {
  // wrangler runs pinned to the package root, so a relative path the operator typed has to be
  // anchored to THEIR directory or it silently lands inside node_modules.
  it("anchors a relative path to the directory the operator typed it in", () => {
    expect(resolveUserPath("backups", "/home/alex/app")).toBe("/home/alex/app/backups");
    expect(resolveUserPath("./backups", "/home/alex/app")).toBe("/home/alex/app/backups");
    expect(resolveUserPath("a/b", "/home/alex/app/")).toBe("/home/alex/app/a/b");
  });

  it("leaves an absolute path exactly as given", () => {
    expect(resolveUserPath("/mnt/archive", "/home/alex/app")).toBe("/mnt/archive");
  });

  it("treats '.' as the cwd itself", () => {
    expect(resolveUserPath("./", "/home/alex/app")).toBe("/home/alex/app");
  });
});

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
