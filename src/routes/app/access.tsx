import * as accessRequests from "../../db/access-requests";
import { isEmail } from "../../lib/text";
import { loadBranding } from "../../services/branding";
import { AccessPage, RequestReceivedPage } from "../../views/access-page";
import { renderPage } from "../../views/layout";
import type { AppContext } from "./app-context";

// §13 — the public "request access" page (GET) and its submission (POST → a pending request the
// admin reviews). No token required.

export async function accessRoute(c: AppContext): Promise<Response> {
  const branding = await loadBranding(c.get("deps"));
  return c.html(renderPage(<AccessPage appName={branding.appName} accent={branding.accent} />));
}

export async function postAccessRoute(c: AppContext): Promise<Response> {
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const branding = await loadBranding(deps);

  if (!isEmail(email)) {
    return c.html(
      renderPage(<AccessPage appName={branding.appName} accent={branding.accent} />),
      400,
    );
  }

  await accessRequests.insert(deps.db, {
    email,
    ip: c.req.header("cf-connecting-ip") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
    createdAt: deps.clock(),
  });
  return c.html(
    renderPage(<RequestReceivedPage appName={branding.appName} accent={branding.accent} />),
  );
}
