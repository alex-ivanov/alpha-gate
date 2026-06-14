import { describe, expect, it } from "vitest";
import type { ApplyStep, Finding, InspectStep, PreflightItem } from "../../src/deploy/core/types";
import {
  renderApply,
  renderFindings,
  renderHeader,
  renderInspect,
  renderPreflight,
} from "../../src/deploy/core/ui";

// The transparency UI is pure, so we assert exactly what the operator sees: phase headers, the why,
// the exact command, status markers, and that a skip shows its reason (not a command).

describe("renderHeader", () => {
  it("names the instance", () => {
    expect(renderHeader("myalpha")).toContain("instance: myalpha");
  });
});

describe("renderPreflight", () => {
  it("marks each tool ✓/✗ and shows the detail/fix on one PREFLIGHT line", () => {
    const items: PreflightItem[] = [
      { name: "node", ok: true, detail: "node 20.11" },
      { name: "auth", ok: false, detail: "login → run npx wrangler login" },
    ];
    const out = renderPreflight(items);
    expect(out).toContain("PREFLIGHT");
    expect(out).toContain("✓ node 20.11");
    expect(out).toContain("✗ login → run npx wrangler login");
  });
});

describe("renderInspect", () => {
  it("shows the read-only header, the why, and the exact command for each step", () => {
    const steps: InspectStep[] = [
      { why: "account & login", command: "wrangler whoami" },
      { why: "database exists?", command: "wrangler d1 list --json" },
    ];
    const out = renderInspect(steps);
    expect(out).toContain("1 · INSPECT");
    expect(out).toContain("read-only");
    expect(out).toContain("• account & login");
    expect(out).toContain("wrangler whoami");
    expect(out).toContain("wrangler d1 list --json");
  });

  it("aligns the command column (why-labels padded to equal width)", () => {
    const steps: InspectStep[] = [
      { why: "short", command: "cmd-a" },
      { why: "a much longer why", command: "cmd-b" },
    ];
    const lines = renderInspect(steps).split("\n").slice(1); // drop the header
    const colA = lines[0]?.indexOf("cmd-a");
    const colB = lines[1]?.indexOf("cmd-b");
    expect(colA).toBe(colB); // commands start at the same column
  });
});

describe("renderFindings", () => {
  it("echoes each learned fact", () => {
    const findings: Finding[] = [
      { label: "database", value: "not found" },
      { label: "Access", value: "not configured" },
    ];
    const out = renderFindings(findings);
    expect(out).toContain("✓ database");
    expect(out).toContain("not found");
    expect(out).toContain("✓ Access");
  });
});

describe("renderApply", () => {
  const steps: ApplyStep[] = [
    { kind: "create", what: "database", why: "not found", command: "wrangler d1 create x" },
    { kind: "skip", what: "bucket", why: "exists — skipping", command: "" },
  ];

  it("uses + for a create and shows its exact command", () => {
    const out = renderApply(steps);
    expect(out).toContain("2 · APPLY");
    expect(out).toContain("+ database");
    expect(out).toContain("wrangler d1 create x");
  });

  it("uses · for a skip and shows the reason, never a command", () => {
    const out = renderApply(steps);
    const skipLine = out.split("\n").find((l) => l.includes("bucket"));
    expect(skipLine).toContain("· bucket");
    expect(skipLine).toContain("exists — skipping");
  });
});
