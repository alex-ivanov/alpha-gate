import { describe, expect, it } from "vitest";
import {
  archiveKey,
  auditAnchorKey,
  BRANDING_ICON_KEY,
  sanitizeFilename,
} from "../../../src/r2/keys";

// Decision 0003 — R2 key layout, single-sourced here.

describe("archiveKey", () => {
  it("uses the build/<number>/<filename> layout", () => {
    expect(archiveKey(1500, "App.zip")).toBe("build/1500/App.zip");
    expect(archiveKey(1500, "App.dmg")).toBe("build/1500/App.dmg");
  });

  it("strips any path so a filename can't escape its build prefix", () => {
    expect(archiveKey(1500, "../../etc/passwd")).toBe("build/1500/passwd");
    expect(archiveKey(1500, "a/b/c.zip")).toBe("build/1500/c.zip");
  });
});

describe("sanitizeFilename", () => {
  it("replaces unsafe characters and falls back to a placeholder", () => {
    expect(sanitizeFilename("My App v1.2.zip")).toBe("My_App_v1.2.zip");
    expect(sanitizeFilename("")).toBe("artifact");
    expect(sanitizeFilename("///")).toBe("artifact");
  });
});

describe("fixed keys", () => {
  it("matches the §6 branding key and a per-run anchor key", () => {
    expect(BRANDING_ICON_KEY).toBe("branding/icon");
    expect(auditAnchorKey("2026-06-13T00:00:00Z")).toBe("audit/anchor/2026-06-13T00:00:00Z.json");
  });
});
