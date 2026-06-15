import { renderInvite } from "../../core/invite-template";
import type { AdminAction } from "../../core/no-build";
import { generateToken } from "../../core/tokens";
import * as clients from "../../db/clients";
import * as streams from "../../db/streams";
import { inviteUrl } from "../../lib/hosts";
import { recordAudit } from "../../services/audit";
import { loadBranding, loadInviteTemplate } from "../../services/branding";
import { InvitePage, ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { guardStranding } from "./confirm";
import { field, isEmail, toId } from "./form";
import { requireUser } from "./middleware";

// §10/§13 — client mutations. Every handler requires a human actor (service tokens are refused),
// validates its inputs defensively, runs the §11 confirm flow for stranding actions, and records an
// audit row. Plain <form> POSTs; success redirects to the users list (or shows the invite link).

// The invite points at the public App host, never the gated Admin host this request hit (see app-origin).
function getUrl(c: AdminContext, token: string): string {
  return inviteUrl(c.req.url, token);
}

export async function createClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();

  const emailRaw = field(body, "email");
  const email = emailRaw === null ? null : emailRaw.trim();
  if (email === null || !isEmail(email)) return c.text("A valid email is required", 400);
  const label = field(body, "label");
  const streamId = toId(field(body, "streamId"));

  // email is UNIQUE; a re-add would otherwise hit the DB constraint and surface as a bare 500. Tell the
  // admin the user already exists and point at managing them (Reissue resends a fresh link) — §12.
  const existing = await clients.findByEmail(deps.db, email);
  if (existing !== null) {
    return c.html(
      renderPage(
        <ResultPage
          title="User already exists"
          intent="error"
          back={{ href: "/admin/users", label: "← Back to users" }}
        >
          <p>
            A user with <strong>{email}</strong> already exists. Open their{" "}
            <a href={`/admin/users/${existing.id}`}>user page</a> — use <strong>Reissue</strong> to
            send a fresh invite link, or <strong>Revoke</strong> to disable access.
          </p>
        </ResultPage>,
      ),
      409,
    );
  }

  const token = generateToken();
  const client = await clients.insert(deps.db, { email, token, label });
  if (streamId !== null) await streams.assignUser(deps.db, client.id, streamId);
  await recordAudit(deps, auditFields(c, "client.create", email, JSON.stringify({ streamId })));

  const url = getUrl(c, token);
  const branding = await loadBranding(deps);
  const template = await loadInviteTemplate(deps);
  const invite = renderInvite(template, { appName: branding.appName, getUrl: url, token });
  await deps.email.send({ to: email, subject: invite.subject, body: invite.body });

  return c.html(renderPage(<InvitePage email={email} getUrl={url} />));
}

export async function revokeClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);

  await clients.setStatus(deps.db, id, "revoked");
  await recordAudit(deps, auditFields(c, "client.revoke", client.email));
  return c.redirect("/admin/users", 303);
}

export async function reissueClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);

  const token = generateToken();
  await clients.setToken(deps.db, id, token);
  await recordAudit(deps, auditFields(c, "client.reissue", client.email));
  return c.html(renderPage(<InvitePage email={client.email} getUrl={getUrl(c, token)} />));
}

export async function assignStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  const streamId = toId(field(await c.req.parseBody(), "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);

  await streams.assignUser(deps.db, id, streamId); // adding access never strands
  await recordAudit(
    deps,
    auditFields(c, "stream.assign", String(id), JSON.stringify({ streamId })),
  );
  return c.redirect("/admin/users", 303);
}

export async function unassignStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  const streamId = toId(field(body, "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);

  const action: AdminAction = { type: "unassign-user-stream", clientId: id, streamId };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/clients/${id}/streams/unassign`,
    { streamId: String(streamId) },
  );
  if (blocked !== null) return blocked;

  await streams.unassignUser(deps.db, id, streamId);
  await recordAudit(
    deps,
    auditFields(c, "stream.unassign", String(id), JSON.stringify({ streamId })),
  );
  return c.redirect("/admin/users", 303);
}

export async function pinClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  const buildId = toId(field(body, "buildId"));
  if (id === null || buildId === null) return c.text("Bad request", 400);

  const action: AdminAction = { type: "pin-client", clientId: id, buildId };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/clients/${id}/pin`,
    {
      buildId: String(buildId),
    },
  );
  if (blocked !== null) return blocked;

  await clients.setPinnedBuild(deps.db, id, buildId);
  await recordAudit(deps, auditFields(c, "client.pin", String(id), JSON.stringify({ buildId })));
  return c.redirect("/admin/users", 303);
}

export async function unpinClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  // Unpinning can strand a user whose pinned build was their only servable target → §11 confirm.
  const action: AdminAction = { type: "unpin-client", clientId: id };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/clients/${id}/unpin`,
    {},
  );
  if (blocked !== null) return blocked;

  await clients.setPinnedBuild(deps.db, id, null);
  await recordAudit(deps, auditFields(c, "client.unpin", String(id)));
  return c.redirect("/admin/users", 303);
}
