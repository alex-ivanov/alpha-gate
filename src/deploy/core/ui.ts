import type { Palette } from "./colors";
import { type Cell, renderTable } from "./table";
import type { ApplyStep, Finding, InspectStep, PreflightItem } from "./types";

// The "grouped panels" console UI: phased, table-formatted, color when the terminal supports it. Pure
// — every function returns the string to print and takes the Palette in, so wording/alignment/markers
// are unit-tested and color is a presentation detail decided at the edge. Transparency contract holds:
// the operator always sees the phase, the reason ("why"), and the exact command before anything runs.

export function renderHeader(instance: string, palette: Palette): string {
  return palette.bold(`Alpha Gate deploy · ${instance}`);
}

/** Preflight tool/auth checks as a table: ✓ green / ✗ red with the detail or fix-it hint. */
export function renderPreflight(items: readonly PreflightItem[], palette: Palette): string {
  const rows: Cell[][] = items.map((item) => [
    { text: item.name },
    {
      text: `${item.ok ? "✓" : "✗"} ${item.detail}`,
      style: item.ok ? palette.green : palette.red,
    },
  ]);
  return renderTable(rows, palette, { head: ["Check", "Result"] });
}

/** Read-only INSPECT phase: a Why | Command table; commands dimmed. */
export function renderInspect(steps: readonly InspectStep[], palette: Palette): string {
  const rows: Cell[][] = steps.map((s) => [
    { text: s.why },
    { text: s.command, style: palette.dim },
  ]);
  return [
    palette.bold("1 · INSPECT") + palette.dim("  read-only — learn current state"),
    renderTable(rows, palette, { head: ["Why", "Command"] }),
  ].join("\n");
}

/** The facts learned during INSPECT, echoed before the APPLY plan. */
export function renderFindings(findings: readonly Finding[], palette: Palette): string {
  const rows: Cell[][] = findings.map((f) => [
    { text: f.label },
    { text: f.value, style: palette.cyan },
  ]);
  return renderTable(rows, palette, { head: ["Resource", "State"] });
}

const MARK: Record<ApplyStep["kind"], string> = {
  create: "+",
  update: "~",
  delete: "-",
  skip: "·",
};

/** A Δ | Resource | Command-or-reason table under a heading; marker colored by change kind. Shared by
 * the deploy APPLY phase and the teardown DESTROY plan. */
function renderStepTable(heading: string, steps: readonly ApplyStep[], palette: Palette): string {
  const markStyle: Record<ApplyStep["kind"], (s: string) => string> = {
    create: palette.green,
    update: palette.cyan,
    delete: palette.red,
    skip: palette.dim,
  };
  const rows: Cell[][] = steps.map((s) => [
    { text: MARK[s.kind], style: markStyle[s.kind] },
    { text: s.what },
    { text: s.kind === "skip" ? s.why : s.command, style: palette.dim },
  ]);
  return [
    heading,
    renderTable(rows, palette, { head: ["Δ", "Resource", "Command / reason"] }),
  ].join("\n");
}

/** Mutating APPLY phase (deploy). */
export function renderApply(steps: readonly ApplyStep[], palette: Palette): string {
  return renderStepTable(
    palette.bold("2 · APPLY") + palette.dim("  creates/changes resources"),
    steps,
    palette,
  );
}

/** Destructive plan (teardown). */
export function renderDestroy(steps: readonly ApplyStep[], palette: Palette): string {
  return renderStepTable(
    palette.bold("DESTROY") + palette.dim("  this permanently deletes resources"),
    steps,
    palette,
  );
}

/**
 * A step only the operator can do (e.g. enabling Cloudflare Access in the dashboard). The CLI shows
 * this, then BLOCKS on a prompt seam until the operator confirms it's done — see seams/io waitForDone.
 */
export function renderManualStep(
  title: string,
  steps: readonly string[],
  palette: Palette,
): string {
  const lines = [
    palette.yellow(`⚙ MANUAL STEP — only you can do this`),
    title,
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
  ];
  return lines.join("\n");
}
