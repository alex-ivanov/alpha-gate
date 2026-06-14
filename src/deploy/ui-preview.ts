import { selectPalette, shouldColor } from "./core/colors";
import type { ApplyStep, Finding, InspectStep, PreflightItem } from "./core/types";
import {
  renderApply,
  renderFindings,
  renderHeader,
  renderInspect,
  renderManualStep,
  renderPreflight,
} from "./core/ui";

// Dev preview of the deploy CLI's UI — `npm run ui:preview` (add FORCE_COLOR=1 to see colors when
// piped). Renders the scenarios that matter: fresh install, idempotent re-run, and a manual step.

const RES = "alpha-gate-myalpha";
const palette = selectPalette(shouldColor(process.env, process.stdout.isTTY === true));

const PREFLIGHT: PreflightItem[] = [
  { name: "node", ok: true, detail: "node 20.11" },
  { name: "wrangler", ok: true, detail: "wrangler 4.100" },
  { name: "auth", ok: true, detail: "login jane@acme" },
];

const INSPECT: InspectStep[] = [
  { why: "account & login", command: "wrangler whoami" },
  { why: "database exists?", command: "wrangler d1 list --json" },
  { why: "bucket exists?", command: `wrangler r2 bucket info ${RES}` },
  { why: "Access wired?", command: "wrangler secret list -c admin.toml --format json" },
];

function show(title: string, findings: Finding[], apply: ApplyStep[]): void {
  console.log(
    [
      `\n\n══════════  ${title}  ══════════\n`,
      renderHeader("myalpha", palette),
      "",
      renderPreflight(PREFLIGHT, palette),
      "",
      renderInspect(INSPECT, palette),
      "  ↳ run these 4 read-only checks?  [Y/n]",
      "",
      renderFindings(findings, palette),
      "",
      renderApply(apply, palette),
      "  ↳ apply changes?  [y/N]",
    ].join("\n"),
  );
}

show(
  "FRESH INSTALL",
  [
    { label: "database", value: "not found" },
    { label: "bucket", value: "not found" },
    { label: "Access", value: "not configured" },
  ],
  [
    { kind: "create", what: "database", why: "", command: `wrangler d1 create ${RES}` },
    { kind: "create", what: "bucket", why: "", command: `wrangler r2 bucket create ${RES}` },
    {
      kind: "create",
      what: "migrations",
      why: "",
      command: "wrangler d1 migrations apply --remote",
    },
    {
      kind: "create",
      what: "seed config",
      why: "",
      command: "wrangler d1 execute (app_name, scheme)",
    },
    { kind: "create", what: "deploy app", why: "", command: "wrangler deploy -c app.toml" },
    { kind: "create", what: "deploy admin", why: "", command: "wrangler deploy -c admin.toml" },
  ],
);

show(
  "RE-RUN (idempotent)",
  [
    { label: "database", value: "exists (a1b2…)" },
    { label: "bucket", value: "exists" },
    { label: "Access", value: "configured" },
  ],
  [
    { kind: "skip", what: "database", why: "exists — skipping", command: "" },
    { kind: "skip", what: "bucket", why: "exists — skipping", command: "" },
    {
      kind: "update",
      what: "migrations",
      why: "",
      command: "wrangler d1 migrations apply --remote",
    },
    { kind: "skip", what: "seed config", why: "not a first init — skipping", command: "" },
    { kind: "update", what: "deploy app", why: "", command: "wrangler deploy -c app.toml" },
    { kind: "update", what: "deploy admin", why: "", command: "wrangler deploy -c admin.toml" },
  ],
);

console.log(`\n\n══════════  MANUAL STEP (CLI waits for you)  ══════════\n`);
console.log(
  renderManualStep(
    "Enable Cloudflare Access on the admin Worker, then come back:",
    [
      "Zero Trust → Access → Applications → Add (Self-hosted)",
      `Hostname: ${RES}-admin.workers.dev`,
      "Add a policy allowing your email (one-time PIN)",
      "Copy the Application Audience (AUD) tag",
    ],
    palette,
  ),
);
console.log("  ↳ Press Enter once that's done and you have the AUD …");
