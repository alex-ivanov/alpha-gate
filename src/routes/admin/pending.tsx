import { renderInvite } from "../../core/invite-template";
import { generateToken } from "../../core/tokens";
import * as accessRequests from "../../db/access-requests";
import * as clients from "../../db/clients";
import { inviteUrl } from "../../lib/hosts";
import { recordAudit } from "../../services/audit";
import { loadBranding, loadInviteTemplate } from "../../services/branding";
import { InvitePage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { toId } from "./form";
import { requireUser } from "./middleware";

// §13 #10 — acting on a pending access request: invite (reissue an existing client by email, or
// create a new one) and show the /get link, or dismiss. Human-only.

export async function invitePending(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);
  const request = await accessRequests.getById(deps.db, id);
  if (request === null) return c.text("Not found", 404);

  const token = generateToken();
  const existing = await clients.findByEmail(deps.db, request.email);
  if (existing !== null) {
    // Re-grant to an existing client (the revoked-user re-access path, §12). Reissue the token AND
    // re-activate — without flipping status back to "active" a revoked re-requester's new /get link is
    // dead on arrival (every public route gates on kind === "active").
    await clients.setToken(deps.db, existing.id, token);
    if (existing.status !== "active") await clients.setStatus(deps.db, existing.id, "active");
  } else {
    await clients.insert(deps.db, { email: request.email, token });
  }
  await accessRequests.setStatus(deps.db, id, "handled");
  await recordAudit(deps, auditFields(c, "request.invite", request.email));

  const url = inviteUrl(c.req.url, token);
  const branding = await loadBranding(deps);
  const template = await loadInviteTemplate(deps);
  const invite = renderInvite(template, { appName: branding.appName, getUrl: url, token });
  await deps.email.send({ to: request.email, subject: invite.subject, body: invite.body });

  return c.html(renderPage(<InvitePage email={request.email} getUrl={url} />));
}

export async function dismissPending(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  await accessRequests.setStatus(deps.db, id, "dismissed");
  await recordAudit(deps, auditFields(c, "request.dismiss", String(id)));
  return c.redirect("/admin/pending", 303);
}
