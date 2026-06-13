import { loadBranding } from "../../services/branding";
import { AccessPage } from "../../views/access-page";
import { renderPage } from "../../views/layout";
import type { AppContext } from "./app-context";

// §13 — the public "request access" page. No token required.
export async function accessRoute(c: AppContext): Promise<Response> {
  const branding = await loadBranding(c.get("deps"));
  return c.html(renderPage(<AccessPage appName={branding.appName} accent={branding.accent} />));
}
