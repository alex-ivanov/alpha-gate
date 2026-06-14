import type { ApplyStep, Finding, InspectStep, PreflightItem } from "./types";

// The "grouped panels" console UI (the operator-approved layout). Every function here is PURE — it
// returns the string to print — so the exact wording/alignment is unit-tested and nothing about what
// the CLI shows depends on side effects. The transparency contract: the operator always sees the
// phase, the reason ("why"), and the exact command before anything runs.

const OK = "✓";
const FAIL = "✗";
const BULLET = "•";
const MARK: Record<ApplyStep["kind"], string> = {
  create: "+",
  update: "~",
  delete: "-",
  skip: "·",
};

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function widestOf(labels: readonly string[]): number {
  return labels.reduce((max, label) => Math.max(max, label.length), 0);
}

export function renderHeader(instance: string): string {
  return `Alpha Gate deploy · instance: ${instance}\n${"─".repeat(48)}`;
}

/** One compact line: `PREFLIGHT  ✓ node 20  ✓ wrangler 4.100  ✗ login → run npx wrangler login`. */
export function renderPreflight(items: readonly PreflightItem[]): string {
  const cells = items.map((item) => `${item.ok ? OK : FAIL} ${item.detail}`);
  return `PREFLIGHT\n  ${cells.join("   ")}`;
}

/** The read-only INSPECT panel: why-label aligned, exact command alongside. */
export function renderInspect(steps: readonly InspectStep[]): string {
  const width = widestOf(steps.map((step) => step.why));
  const lines = steps.map((step) => `  ${BULLET} ${pad(step.why, width)}  ${step.command}`);
  return ["1 · INSPECT   read-only — learn current state", ...lines].join("\n");
}

/** The facts learned during INSPECT, echoed before the APPLY plan is shown. */
export function renderFindings(findings: readonly Finding[]): string {
  const width = widestOf(findings.map((finding) => finding.label));
  return findings
    .map((finding) => `  ${OK} ${pad(finding.label, width)}  ${finding.value}`)
    .join("\n");
}

/** The mutating APPLY panel: a +/~/-/· marker per change, with the exact command (or skip reason). */
export function renderApply(steps: readonly ApplyStep[]): string {
  const width = widestOf(steps.map((step) => step.what));
  const lines = steps.map((step) => {
    const head = `  ${MARK[step.kind]} ${pad(step.what, width)}`;
    return step.kind === "skip" ? `${head}  ${step.why}` : `${head}  ${step.command}`;
  });
  return ["2 · APPLY   creates/changes resources", ...lines].join("\n");
}
