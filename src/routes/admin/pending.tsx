import { generateToken } from "../../core/tokens";
import * as accessRequests from "../../db/access-requests";
import * as clients from "../../db/clients";
import { recordAudit } from "../../services/audit";
import { InvitePage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { doneRedirect } from "./flash";
import { toId } from "./form";
import { sendInvite } from "./invite";
import { requireUser } from "./middleware";

// §13 #10 — acting on a pending access request: invite (reissue an existing client by email, or
// create a new one) and show the /get link, or dismiss. Human-only. Both resolve EVERY pending row
// for the email, not just the clicked one — duplicates are the norm in copy-paste mode, and a stale
// sibling's Invite button would otherwise silently rotate the token that was just sent.

export async function invitePending(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);
  const request = await accessRequests.getById(deps.db, id);
  if (request === null) return c.text("Not found", 404);

  const token = generateToken();
  const existing = await clients.findByEmail(deps.db, request.email);
  const restored = existing !== null && existing.status !== "active";
  if (existing !== null) {
    // Re-grant to an existing client (the revoked-user re-access path, §12). Reissue the token AND
    // re-activate — without flipping status back to "active" a revoked re-requester's new /get link is
    // dead on arrival (every public route gates on kind === "active").
    await clients.setToken(deps.db, existing.id, token);
    if (restored) {
      await clients.setStatus(deps.db, existing.id, "active");
      await recordAudit(deps, auditFields(c, "client.reactivate", request.email));
    }
  } else {
    await clients.insert(deps.db, { email: request.email, token });
  }
  await accessRequests.setStatusByEmail(deps.db, request.email, "handled");
  await recordAudit(deps, auditFields(c, "request.invite", request.email));

  // Delivery never throws: a failed send still returns the link (the copy-paste fallback) with a notice.
  const { url, delivery, message } = await sendInvite(c, request.email, token);
  return c.html(
    renderPage(
      <InvitePage
        email={request.email}
        getUrl={url}
        delivery={delivery}
        message={message}
        restored={restored}
      />,
    ),
  );
}

export async function dismissPending(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const request = await accessRequests.getById(deps.db, id);
  if (request === null) return c.text("Not found", 404); // no phantom audit rows for stale clicks

  await accessRequests.setStatusByEmail(deps.db, request.email, "dismissed");
  await recordAudit(deps, auditFields(c, "request.dismiss", request.email));
  return doneRedirect(c, body, "/admin/pending", "request.dismissed", request.email);
}
