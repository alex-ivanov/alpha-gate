import { describe, expect, it } from "vitest";
import { compareVersion, isUpdateAvailable } from "../../../src/core/version";

// §22 self-update: compare the running TOOL_VERSION against an upstream manifest. The manifest comes
// from an untrusted fetch, so isUpdateAvailable must be defensive (never throw, default to "no update").

describe("compareVersion", () => {
  it.each([
    { name: "equal versions", a: "1.2.3", b: "1.2.3", sign: 0 },
    { name: "greater patch", a: "1.2.4", b: "1.2.3", sign: 1 },
    { name: "lesser patch", a: "1.2.3", b: "1.2.4", sign: -1 },
    { name: "numeric, not lexical (1.10 > 1.9)", a: "1.10.0", b: "1.9.0", sign: 1 },
    { name: "missing segments are zero (1.2 == 1.2.0)", a: "1.2", b: "1.2.0", sign: 0 },
    { name: "a leading v is tolerated", a: "v1.2.0", b: "1.2.0", sign: 0 },
    { name: "a prerelease ranks below its release", a: "1.2.0-beta", b: "1.2.0", sign: -1 },
  ])("$name", ({ a, b, sign }) => {
    expect(Math.sign(compareVersion(a, b))).toBe(sign);
  });
});

describe("isUpdateAvailable", () => {
  it("reports an update when latest is newer than the running version", () => {
    const status = isUpdateAvailable("1.2.0", { latest: "1.3.0", breaking: false });
    expect(status.available).toBe(true);
    expect(status.latest).toBe("1.3.0");
    expect(status.breaking).toBe(false);
  });

  it("reports no update when the running version is the latest or newer", () => {
    expect(isUpdateAvailable("1.3.0", { latest: "1.3.0" }).available).toBe(false);
    expect(isUpdateAvailable("1.4.0", { latest: "1.3.0" }).available).toBe(false);
  });

  it("passes through the breaking flag and the notes URL", () => {
    const status = isUpdateAvailable("1.2.0", {
      latest: "2.0.0",
      breaking: true,
      notes_url: "https://example.test/releases/2.0.0",
    });
    expect(status.breaking).toBe(true);
    expect(status.notesUrl).toBe("https://example.test/releases/2.0.0");
  });

  it("flags running below min_supported", () => {
    const status = isUpdateAvailable("1.0.0", { latest: "1.3.0", min_supported: "1.1.0" });
    expect(status.belowMinSupported).toBe(true);
  });

  it("is defensive against a malformed manifest — never throws, defaults to no update", () => {
    // @ts-expect-error latest must be a string
    expect(isUpdateAvailable("1.2.0", { latest: 123 }).available).toBe(false);
    // @ts-expect-error manifest must be an object
    expect(isUpdateAvailable("1.2.0", null).available).toBe(false);
    // @ts-expect-error latest is required
    expect(isUpdateAvailable("1.2.0", {}).available).toBe(false);
  });
});
