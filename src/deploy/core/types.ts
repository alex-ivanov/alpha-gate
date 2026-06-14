// Shared data shapes for the deploy CLI. Kept free of I/O so the planner, the renderer, and the
// validators are all pure functions over plain data (mirrors the app's pure-core discipline).

export type Role = "app" | "admin";

/** A read-only command the CLI will run during the INSPECT phase, with the reason it's needed. */
export interface InspectStep {
  /** Short, human reason shown to the operator (the "why"). */
  why: string;
  /** The exact command, shown verbatim so nothing runs unseen. */
  command: string;
}

/** A fact learned during INSPECT, echoed back before planning the APPLY phase. */
export interface Finding {
  label: string;
  value: string;
}

export type ApplyKind = "create" | "update" | "skip" | "delete";

/** A single change the APPLY phase will make (or skip), with its reason and exact command. */
export interface ApplyStep {
  kind: ApplyKind;
  /** Short label for the thing being changed, e.g. "database". */
  what: string;
  /** The reason / detail (also the displayed text for a `skip`). */
  why: string;
  /** The exact command; empty for a `skip` (nothing runs). */
  command: string;
}

/** Result of a single preflight tool/auth check. */
export interface PreflightItem {
  name: string;
  ok: boolean;
  /** What to show — the version/account on success, or the fix-it hint on failure. */
  detail: string;
}
