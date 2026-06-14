import { describe, expect, it } from "vitest";
import { colorPalette, plainPalette } from "../../src/deploy/core/colors";
import type { ApplyStep, Finding, InspectStep, PreflightItem } from "../../src/deploy/core/types";
import {
  renderApply,
  renderFindings,
  renderHeader,
  renderInspect,
  renderManualStep,
  renderPreflight,
} from "../../src/deploy/core/ui";

// Rendered with plainPalette so assertions are color-code-free; the structure (tables, headers, why,
// exact command, markers, skip reasons) is what we pin.

const P = plainPalette;

describe("renderHeader", () => {
  it("names the instance", () => {
    expect(renderHeader("myalpha", P)).toContain("myalpha");
  });
});

describe("renderPreflight", () => {
  it("tables each check with ✓/✗ and the detail/fix", () => {
    const items: PreflightItem[] = [
      { name: "node", ok: true, detail: "node 20.11" },
      { name: "auth", ok: false, detail: "run npx wrangler login" },
    ];
    const out = renderPreflight(items, P);
    expect(out).toContain("Check");
    expect(out).toContain("✓ node 20.11");
    expect(out).toContain("✗ run npx wrangler login");
  });
});

describe("renderInspect", () => {
  it("shows the read-only header, a Why|Command table, and the exact command", () => {
    const steps: InspectStep[] = [
      { why: "account & login", command: "wrangler whoami" },
      { why: "database exists?", command: "wrangler d1 list --json" },
    ];
    const out = renderInspect(steps, P);
    expect(out).toContain("1 · INSPECT");
    expect(out).toContain("read-only");
    expect(out).toContain("Why");
    expect(out).toContain("account & login");
    expect(out).toContain("wrangler d1 list --json");
  });
});

describe("renderFindings", () => {
  it("tables each learned fact", () => {
    const findings: Finding[] = [{ label: "database", value: "not found" }];
    const out = renderFindings(findings, P);
    expect(out).toContain("Resource");
    expect(out).toContain("database");
    expect(out).toContain("not found");
  });
});

describe("renderApply", () => {
  const steps: ApplyStep[] = [
    { kind: "create", what: "database", why: "", command: "wrangler d1 create x" },
    { kind: "skip", what: "bucket", why: "exists — skipping", command: "" },
  ];

  it("shows + for a create with its exact command", () => {
    const out = renderApply(steps, P);
    expect(out).toContain("2 · APPLY");
    expect(out).toContain("wrangler d1 create x");
    expect(out).toMatch(/\+ .*database|database.*\+/);
  });

  it("shows · and the reason for a skip — never a command", () => {
    const out = renderApply(steps, P);
    const skipLine = out.split("\n").find((l) => l.includes("bucket"));
    expect(skipLine).toContain("·");
    expect(skipLine).toContain("exists — skipping");
  });
});

describe("renderManualStep", () => {
  it("labels it a manual step and numbers the instructions", () => {
    const out = renderManualStep(
      "Enable Cloudflare Access:",
      ["Open Zero Trust", "Add a policy"],
      P,
    );
    expect(out).toContain("MANUAL STEP");
    expect(out).toContain("Enable Cloudflare Access:");
    expect(out).toContain("1. Open Zero Trust");
    expect(out).toContain("2. Add a policy");
  });
});

describe("color", () => {
  it("wraps with ANSI under colorPalette and is identity under plainPalette", () => {
    expect(renderHeader("x", colorPalette)).toContain("\x1b[");
    expect(renderHeader("x", plainPalette)).not.toContain("\x1b[");
  });
});
