import { resolveBranding } from "../../core/invite-template";
import { AccessPage } from "../../views/access-page";
import { renderPage } from "../../views/layout";
import type { AppContext } from "./app-context";

// §13 — the public "request access" page. No token required.
export function accessRoute(c: AppContext): Response {
  const branding = resolveBranding({}); // meta-backed branding wired in M15
  return c.html(renderPage(<AccessPage appName={branding.appName} accent={branding.accent} />));
}
