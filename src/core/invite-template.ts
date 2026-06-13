// §13/§6 — invite text and the branded /get page model. Pure: placeholder fill and default merge.
// The DEFAULT_INVITE_TEMPLATE here is the runtime fallback when the admin has set nothing in `meta`;
// templates/invite-email.txt mirrors it as the human-editable canonical (kept in sync by hand).

export interface InviteTemplate {
  subject: string;
  body: string;
}

export interface InviteVars {
  appName: string;
  getUrl: string;
  token: string;
}

export const DEFAULT_INVITE_TEMPLATE: InviteTemplate = {
  subject: "You're invited to test {app_name}",
  body: `Hi,

You've been added to the {app_name} alpha. To get started:

  1. Open your private download page:  {get_url}
  2. Download and install the app.
  3. Launch it, then click "Activate" on the page (or paste the key shown there).

That page is yours — revisit it any time to reinstall. It stops working if access is revoked.`,
};

/** Replaces {app_name}/{get_url}/{token} in one pass (a value can't reintroduce a placeholder). */
export function fillTemplate(text: string, vars: InviteVars): string {
  const replacements: Record<string, string> = {
    "{app_name}": vars.appName,
    "{get_url}": vars.getUrl,
    "{token}": vars.token,
  };
  return text.replace(
    /\{app_name\}|\{get_url\}|\{token\}/g,
    (match) => replacements[match] ?? match,
  );
}

export function renderInvite(template: InviteTemplate, vars: InviteVars): InviteTemplate {
  return {
    subject: fillTemplate(template.subject, vars),
    body: fillTemplate(template.body, vars),
  };
}

/** The resolved /get page branding (§6). */
export interface Branding {
  appName: string;
  blurb: string | null;
  accent: string;
  iconUrl: string | null;
}

/** Clean, never-blocking defaults (decision 0003 sibling): neutral name, system blue, no icon. */
export const DEFAULT_BRANDING: Branding = {
  appName: "Your App",
  blurb: null,
  accent: "#0A84FF",
  iconUrl: null,
};

/** Merges admin overrides (from `meta` / R2 asset URL) over the defaults; ignores undefined. */
export function resolveBranding(overrides: Partial<Branding>): Branding {
  return {
    appName: overrides.appName ?? DEFAULT_BRANDING.appName,
    blurb: overrides.blurb ?? DEFAULT_BRANDING.blurb,
    accent: overrides.accent ?? DEFAULT_BRANDING.accent,
    iconUrl: overrides.iconUrl ?? DEFAULT_BRANDING.iconUrl,
  };
}
