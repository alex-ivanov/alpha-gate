import {
  type Branding,
  DEFAULT_BRANDING,
  DEFAULT_INVITE_TEMPLATE,
  type InviteTemplate,
} from "../core/invite-template";
import { getAll } from "../db/meta";
import type { Deps } from "../deps";

// §6/§13 — resolves the branded /get page model and the invite template from the `meta` table,
// falling back to the clean defaults. The icon/header are served at /assets/icon and /assets/header
// when one has been uploaded (tracked by meta.icon / meta.header = "1").

export async function loadBranding(deps: Deps): Promise<Branding> {
  const all = await getAll(deps.db);
  return {
    appName: all.app_name ?? DEFAULT_BRANDING.appName,
    blurb: all.blurb ?? DEFAULT_BRANDING.blurb,
    accent: all.accent ?? DEFAULT_BRANDING.accent,
    iconUrl: all.icon === "1" ? "/assets/icon" : DEFAULT_BRANDING.iconUrl,
    headerUrl: all.header === "1" ? "/assets/header" : DEFAULT_BRANDING.headerUrl,
  };
}

export async function loadInviteTemplate(deps: Deps): Promise<InviteTemplate> {
  const all = await getAll(deps.db);
  return {
    subject: all.invite_subject ?? DEFAULT_INVITE_TEMPLATE.subject,
    body: all.invite_body ?? DEFAULT_INVITE_TEMPLATE.body,
  };
}
