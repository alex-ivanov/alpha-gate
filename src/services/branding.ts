import {
  type AccessNotice,
  type Branding,
  DEFAULT_ACCESS_NOTICE,
  DEFAULT_BRANDING,
  DEFAULT_INVITE_TEMPLATE,
  fillAppName,
  type InviteTemplate,
  resolveActivateScheme,
  safeAccent,
} from "../core/invite-template";
import { getAll, get as getMeta } from "../db/meta";
import type { Deps } from "../deps";

// §6/§13 — resolves the branded /get page model and the invite template from the `meta` table,
// falling back to the clean defaults. The icon/header are served at /assets/icon and /assets/header
// when one has been uploaded (tracked by meta.icon / meta.header = "1").

export async function loadBranding(deps: Deps): Promise<Branding> {
  const all = await getAll(deps.db);
  return {
    appName: all.app_name ?? DEFAULT_BRANDING.appName,
    blurb: all.blurb ?? DEFAULT_BRANDING.blurb,
    accent: safeAccent(all.accent), // coerce to a safe hex value — this is interpolated raw into CSS
    iconUrl: all.icon === "1" ? "/assets/icon" : DEFAULT_BRANDING.iconUrl,
    headerUrl: all.header === "1" ? "/assets/header" : DEFAULT_BRANDING.headerUrl,
  };
}

/** The §7 activation deep-link scheme (meta.activate_scheme), validated, falling back to the default. */
export async function loadActivateScheme(deps: Deps): Promise<string> {
  return resolveActivateScheme(await getMeta(deps.db, "activate_scheme"));
}

export async function loadInviteTemplate(deps: Deps): Promise<InviteTemplate> {
  const all = await getAll(deps.db);
  return {
    subject: all.invite_subject ?? DEFAULT_INVITE_TEMPLATE.subject,
    body: all.invite_body ?? DEFAULT_INVITE_TEMPLATE.body,
  };
}

/** §15 — the reactivation notice text (meta.notice_title / notice_message), {app_name}-filled. */
export async function loadAccessNotice(deps: Deps): Promise<AccessNotice> {
  const all = await getAll(deps.db);
  const appName = all.app_name ?? DEFAULT_BRANDING.appName;
  return {
    title: fillAppName(all.notice_title ?? DEFAULT_ACCESS_NOTICE.title, appName),
    message: fillAppName(all.notice_message ?? DEFAULT_ACCESS_NOTICE.message, appName),
  };
}
