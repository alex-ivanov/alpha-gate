// The per-instance state ledger (.deploy/<instance>.state.json). It records the resource id + URLs
// plus the remembered inputs. The ON-DISK shape keeps deploy.sh's snake_case keys
// (instance/app_url/admin_url/d1_id) so the existing publish.sh/teardown.sh keep reading it unchanged.
// parseState is tolerant: a missing/corrupt file (or unknown keys, e.g. the retired `phases` array
// from older versions) yields a clean state rather than throwing.

export interface DeployState {
  instance: string;
  d1Id: string | null;
  appUrl: string | null;
  adminUrl: string | null;
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
    emailProvider: null,
    emailFrom: null,
    accessTeamDomain: null,
    accessAud: null,
  };
}

export function serializeState(state: DeployState): string {
  const onDisk = {
    instance: state.instance,
    app_url: state.appUrl,
    admin_url: state.adminUrl,
    d1_id: state.d1Id,
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
    return {
      instance: str(obj.instance) ?? instance,
      d1Id: str(obj.d1_id),
      appUrl: str(obj.app_url),
      adminUrl: str(obj.admin_url),
      emailProvider: str(obj.email_provider),
      emailFrom: str(obj.email_from),
      accessTeamDomain: str(obj.access_team_domain),
      accessAud: str(obj.access_aud),
    };
  } catch {
    return emptyState(instance);
  }
}
