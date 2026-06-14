import { gateToken } from "../../auth/token-gate";
import { loadActivateScheme, loadBranding } from "../../services/branding";
import { NotFoundPage } from "../../views/access-page";
import { GetPage } from "../../views/get-page";
import { renderPage } from "../../views/layout";
import type { AppContext } from "./app-context";

// §6 — the token-gated landing page. Invalid/revoked tokens get the generic 404 (never the get page),
// so existence isn't confirmed. Referrer-Policy:no-referrer keeps the token out of Referer (§16).

export async function getRoute(c: AppContext): Promise<Response> {
  const deps = c.get("deps");
  const gate = await gateToken(deps, c.req.query("token"));
  if (gate.kind !== "active") {
    return c.html(renderPage(<NotFoundPage />), 404);
  }

  const { token } = gate.client;
  const branding = await loadBranding(deps);
  const scheme = await loadActivateScheme(deps); // §7 deep-link scheme (admin-configurable in Settings)
  const downloadUrl = `/download?token=${encodeURIComponent(token)}&via=install`;
  const activateUrl = `${scheme}://activate?token=${encodeURIComponent(token)}`;

  c.header("Referrer-Policy", "no-referrer");
  return c.html(
    renderPage(
      <GetPage
        branding={branding}
        token={token}
        downloadUrl={downloadUrl}
        activateUrl={activateUrl}
      />,
    ),
  );
}
