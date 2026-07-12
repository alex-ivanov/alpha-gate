// The per-instance state ledger (.deploy/<instance>.state.json). It records the resource id + URLs and
// which phases completed (for resume). The ON-DISK shape keeps deploy.sh's snake_case keys
// (instance/app_url/admin_url/d1_id) so the existing publish.sh/teardown.sh keep reading it unchanged.
// parseState is tolerant: a missing/corrupt file yields a clean empty state rather than throwing.

export type Phase = "d1" | "r2" | "migrate" | "seed" | "deployApp" | "deployAdmin" | "access";

const PHASES: readonly Phase[] = [
  "d1",
  "r2",
  "migrate",
  "seed",
  "deployApp",
  "deployAdmin",
  "access",
];

export interface DeployState {
  instance: string;
  d1Id: string | null;
  appUrl: string | null;
  adminUrl: string | null;
  done: Phase[];
  // Remembered inputs so a bare re-run (`deploy --instance X`) preserves them instead of silently
  // reverting to defaults — the classic "email turned itself off on the next deploy" bug.
  emailProvider: string | null;
  emailFrom: string | null;
  accessTeamDomain: string | null;
  accessAud: string | null;
}

export function emptyState(instance: string): DeployState {
  return {
    instance,
    d1Id: null,
    appUrl: null,
    adminUrl: null,
    done: [],
    emailProvider: null,
    emailFrom: null,
    accessTeamDomain: null,
    accessAud: null,
  };
}

export function hasPhase(state: DeployState, phase: Phase): boolean {
  return state.done.includes(phase);
}

export function withPhase(state: DeployState, phase: Phase): DeployState {
  return state.done.includes(phase) ? state : { ...state, done: [...state.done, phase] };
}

export function serializeState(state: DeployState): string {
  const onDisk = {
    instance: state.instance,
    app_url: state.appUrl,
    admin_url: state.adminUrl,
    d1_id: state.d1Id,
    phases: state.done,
    email_provider: state.emailProvider,
    email_from: state.emailFrom,
    access_team_domain: state.accessTeamDomain,
    access_aud: state.accessAud,
  };
  return `${JSON.stringify(onDisk, null, 2)}\n`;
}

export function parseState(json: string, instance: string): DeployState {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
    const rawPhases = Array.isArray(obj.phases) ? obj.phases : [];
    const done = rawPhases.filter(
      (p): p is Phase => typeof p === "string" && (PHASES as readonly string[]).includes(p),
    );
    return {
      instance: str(obj.instance) ?? instance,
      d1Id: str(obj.d1_id),
      appUrl: str(obj.app_url),
      adminUrl: str(obj.admin_url),
      done,
      emailProvider: str(obj.email_provider),
      emailFrom: str(obj.email_from),
      accessTeamDomain: str(obj.access_team_domain),
      accessAud: str(obj.access_aud),
    };
  } catch {
    return emptyState(instance);
  }
}
