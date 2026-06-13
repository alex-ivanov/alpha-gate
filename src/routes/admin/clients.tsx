import { DEFAULT_INVITE_TEMPLATE, renderInvite, resolveBranding } from "../../core/invite-template";
import type { AdminAction } from "../../core/no-build";
import { generateToken } from "../../core/tokens";
import { validateAction } from "../../core/validation";
import * as clients from "../../db/clients";
import * as streams from "../../db/streams";
import { recordAudit } from "../../services/audit";
import { ConfirmPage, InvitePage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { requireUser } from "./middleware";
import { loadValidationWorld } from "./read-model";

// §10/§13 — client mutations. Every handler requires a human actor (service tokens are refused),
// validates its inputs defensively, runs the §11 confirm flow for stranding actions, and records an
// audit row. Plain <form> POSTs; success redirects to the users list (or shows the invite link).

function field(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toId(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getUrl(c: AdminContext, token: string): string {
  return `${new URL(c.req.url).origin}/get?token=${encodeURIComponent(token)}`;
}

export async function createClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();

  const email = field(body, "email");
  if (email === null || !email.includes("@")) return c.text("A valid email is required", 400);
  const label = field(body, "label");
  const streamId = toId(field(body, "streamId"));

  const token = generateToken();
  const client = await clients.insert(deps.db, { email, token, label });
  if (streamId !== null) await streams.assignUser(deps.db, client.id, streamId);
  await recordAudit(deps, auditFields(c, "client.create", email, JSON.stringify({ streamId })));

  const url = getUrl(c, token);
  const branding = resolveBranding({}); // meta-backed in M15
  const invite = renderInvite(DEFAULT_INVITE_TEMPLATE, {
    appName: branding.appName,
    getUrl: url,
    token,
  });
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
  const confirmed = field(body, "confirm") === "true";
  const blocked = await guardStranding(
    c,
    action,
    confirmed,
    `/admin/clients/${id}/streams/unassign`,
    {
      streamId: String(streamId),
    },
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
  const confirmed = field(body, "confirm") === "true";
  const blocked = await guardStranding(c, action, confirmed, `/admin/clients/${id}/pin`, {
    buildId: String(buildId),
  });
  if (blocked !== null) return blocked;

  await clients.setPinnedBuild(deps.db, id, buildId);
  await recordAudit(deps, auditFields(c, "client.pin", String(id), JSON.stringify({ buildId })));
  return c.redirect("/admin/users", 303);
}

export async function unpinClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  await clients.setPinnedBuild(deps.db, id, null); // removing a pin never strands
  await recordAudit(deps, auditFields(c, "client.unpin", String(id)));
  return c.redirect("/admin/users", 303);
}

/**
 * Runs §11 validation for a potentially-stranding action. Returns a 400 (malformed) or the confirm
 * page (needs confirmation, not yet confirmed) to short-circuit the handler, or null to proceed.
 */
async function guardStranding(
  c: AdminContext,
  action: AdminAction,
  confirmed: boolean,
  postTo: string,
  hidden: Record<string, string>,
): Promise<Response | null> {
  const { world, installed } = await loadValidationWorld(c.get("deps"));
  const result = validateAction(world, action, installed);
  if (!result.ok) return c.text(result.error, 400);
  if (result.needsConfirm && !confirmed) {
    return c.html(
      renderPage(
        <ConfirmPage
          action={action.type}
          affected={result.affectedEmails}
          postTo={postTo}
          hidden={{ ...hidden, confirm: "true" }}
        />,
      ),
    );
  }
  return null;
}
