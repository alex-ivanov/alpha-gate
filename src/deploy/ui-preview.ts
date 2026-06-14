import type { ApplyStep, Finding, InspectStep, PreflightItem } from "./core/types";
import {
  renderApply,
  renderFindings,
  renderHeader,
  renderInspect,
  renderPreflight,
} from "./core/ui";

// Dev preview of the deploy CLI's "grouped panels" UI — run `npm run ui:preview` to eyeball the exact
// layout without a real deploy. Renders the two scenarios that matter: a fresh install (everything is
// created) and an idempotent re-run (existing resources are skipped). Not part of the test suite.

const RES = "alpha-gate-myalpha";

const PREFLIGHT: PreflightItem[] = [
  { name: "node", ok: true, detail: "node 20.11" },
  { name: "wrangler", ok: true, detail: "wrangler 4.100" },
  { name: "auth", ok: true, detail: "login jane@acme" },
];

const INSPECT: InspectStep[] = [
  { why: "account & login", command: "wrangler whoami" },
  { why: "database exists?", command: "wrangler d1 list --json" },
  { why: "bucket exists?", command: `wrangler r2 bucket info ${RES}` },
  { why: "Access wired?", command: "wrangler secret list -c …admin.toml --format json" },
];

function show(title: string, findings: Finding[], apply: ApplyStep[]): void {
  const out = [
    `\n\n══════════  ${title}  ══════════\n`,
    renderHeader("myalpha"),
    "",
    renderPreflight(PREFLIGHT),
    "",
    renderInspect(INSPECT),
    "  ↳ run these 4 read-only checks?  [Y/n]",
    "",
    renderFindings(findings),
    "",
    renderApply(apply),
    "  ↳ apply changes?  [y/N]",
  ].join("\n");
  console.log(out);
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
      command: "wrangler d1 migrations apply … --remote",
    },
    {
      kind: "create",
      what: "seed config",
      why: "",
      command: "wrangler d1 execute …  app_name, scheme",
    },
    { kind: "create", what: "deploy app", why: "", command: "wrangler deploy -c myalpha.app.toml" },
    {
      kind: "create",
      what: "deploy admin",
      why: "",
      command: "wrangler deploy -c myalpha.admin.toml",
    },
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
      command: "wrangler d1 migrations apply … --remote",
    },
    { kind: "skip", what: "seed config", why: "not a first init — skipping", command: "" },
    { kind: "update", what: "deploy app", why: "", command: "wrangler deploy -c myalpha.app.toml" },
    {
      kind: "update",
      what: "deploy admin",
      why: "",
      command: "wrangler deploy -c myalpha.admin.toml",
    },
  ],
);
