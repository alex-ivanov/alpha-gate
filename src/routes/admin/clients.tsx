import type { AdminAction } from "../../core/no-build";
import { generateToken } from "../../core/tokens";
import * as builds from "../../db/builds";
import * as clients from "../../db/clients";
import * as streams from "../../db/streams";
import { recordAudit } from "../../services/audit";
import { ConfirmActionPage, InvitePage, ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { guardStranding } from "./confirm";
import { buildSubject, doneRedirect } from "./flash";
import { field, isEmail, returnTo, toId } from "./form";
import { sendInvite } from "./invite";
import { requireUser } from "./middleware";

// §10/§13 — client mutations. Every handler requires a human actor (service tokens are refused),
// validates its inputs defensively, runs the §11 confirm flow for stranding actions, and records an
// audit row. Destructive-but-not-stranding actions (revoke, reissue) are confirmed too: both are
// irreversible from the tester's point of view (a dead app, a dead link) and were one-click before.
// Success 303s back to the page the operator acted from (return_to) with a flash notice.

function errorPage(
  c: AdminContext,
  status: 400 | 404 | 409,
  title: string,
  body: string,
  back: { href: string; label: string },
): Response {
  return c.html(
    renderPage(
      <ResultPage title={title} intent="error" back={back}>
        <p>{body}</p>
      </ResultPage>,
    ),
    status,
  );
}

export async function createClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();

  const emailRaw = field(body, "email");
  const email = emailRaw === null ? null : emailRaw.trim();
  if (email === null || !isEmail(email)) {
    return errorPage(
      c,
      400,
      "That doesn't look like an email address",
      `“${email ?? ""}” isn't a valid email — check for typos and try again.`,
      { href: "/admin/users", label: "← Back to users" },
    );
  }
  const label = field(body, "label");
  const streamId = toId(field(body, "streamId"));

  // The channel must still exist BEFORE the insert — a stale form (channel deleted in another tab)
  // otherwise creates the user, then throws on assignment: a raw 500 that loses the invite link and
  // skips the audit row.
  if (streamId !== null && (await streams.getById(deps.db, streamId)) === null) {
    return errorPage(
      c,
      400,
      "That channel no longer exists",
      `The user was NOT created. The selected channel has been deleted — reload the Users page and pick another (the address you typed was ${email}).`,
      { href: "/admin/users", label: "← Back to users" },
    );
  }

  // email is UNIQUE; a re-add would otherwise hit the DB constraint and surface as a bare 500. Tell the
  // admin the user already exists and point at the right next step for the user's status — §12.
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
            <a href={`/admin/users/${existing.id}`}>user page</a> —{" "}
            {existing.status === "revoked" ? (
              <>
                they are currently <strong>revoked</strong>, so use <strong>Reactivate</strong> to
                restore access (Reissue alone would mint a link that doesn't work).
              </>
            ) : (
              <>
                use <strong>Reissue</strong> to send a fresh invite link, or <strong>Revoke</strong>{" "}
                to disable access.
              </>
            )}
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

  // Delivery never throws: a failed send still returns the link (the copy-paste fallback) with a notice.
  const { url, delivery, message } = await sendInvite(c, email, token);
  return c.html(
    renderPage(<InvitePage email={email} getUrl={url} delivery={delivery} message={message} />),
  );
}

export async function revokeClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  const back = returnTo(body) ?? "/admin/users";

  if (client.status === "revoked") {
    return doneRedirect(c, body, "/admin/users", "noop", `${client.email} is already revoked.`);
  }

  // Irreversible for the tester (their app drops to the reactivation notice) → always confirmed.
  if (field(body, "confirm") !== "true") {
    return c.html(
      renderPage(
        <ConfirmActionPage
          subject={`Revoke ${client.email}`}
          confirmLabel="Revoke access"
          postTo={`/admin/clients/${id}/revoke`}
          hidden={{ confirm: "true", return_to: back }}
          cancelTo={back}
        >
          <p class="muted">
            Their installed app stops receiving updates and shows a reactivation notice; their
            private download link stops working. You can <strong>Reactivate</strong> them later from
            their user page — the same link starts working again.
          </p>
        </ConfirmActionPage>,
      ),
    );
  }

  await clients.setStatus(deps.db, id, "revoked");
  await recordAudit(deps, auditFields(c, "client.revoke", client.email));
  return doneRedirect(c, body, "/admin/users", "user.revoked", client.email);
}

/** The inverse of revoke: the stored token becomes valid again, so the old /get link revives. */
export async function reactivateClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  if (client.status === "active") {
    return doneRedirect(c, body, "/admin/users", "noop", `${client.email} is already active.`);
  }

  await clients.setStatus(deps.db, id, "active");
  await recordAudit(deps, auditFields(c, "client.reactivate", client.email));
  return doneRedirect(c, body, "/admin/users", "user.reactivated", client.email);
}

export async function reissueClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  const back = returnTo(body) ?? "/admin/users";
  const revoked = client.status === "revoked";

  // Rotating the token kills the tester's working app session and their old link → always confirmed.
  // For a revoked user the reissue also reactivates: a fresh link for a still-revoked user would be
  // dead on arrival (every public route gates on status), which was this flow's nastiest trap.
  if (field(body, "confirm") !== "true") {
    return c.html(
      renderPage(
        <ConfirmActionPage
          subject={
            revoked
              ? `Reactivate ${client.email} with a fresh link`
              : `Reissue a fresh link for ${client.email}`
          }
          confirmLabel={revoked ? "Reactivate and reissue" : "Reissue link"}
          postTo={`/admin/clients/${id}/reissue`}
          hidden={{ confirm: "true", return_to: back }}
          cancelTo={back}
        >
          {revoked ? (
            <p class="muted">
              This user is currently revoked. Confirming restores their access with a brand-new
              private link (the old link and any installed app token stay dead).
            </p>
          ) : (
            <p class="muted">
              A new private link replaces the current one immediately: the old link stops working
              and their installed app asks to re-activate. Do this when a link leaked or was lost.
            </p>
          )}
        </ConfirmActionPage>,
      ),
    );
  }

  const token = generateToken();
  await clients.setToken(deps.db, id, token);
  if (revoked) {
    await clients.setStatus(deps.db, id, "active");
    await recordAudit(deps, auditFields(c, "client.reactivate", client.email));
  }
  await recordAudit(deps, auditFields(c, "client.reissue", client.email));
  // Deliver like create does (email when configured; message for copy-paste otherwise).
  const { url, delivery, message } = await sendInvite(c, client.email, token);
  return c.html(
    renderPage(
      <InvitePage
        email={client.email}
        getUrl={url}
        delivery={delivery}
        message={message}
        restored={revoked}
      />,
    ),
  );
}

// Admin-list visibility: hide/unhide declutters the Users list — it never revokes access (that's
// revoke). Toggle via a hidden field.
export async function setClientHidden(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);
  const body = await c.req.parseBody();
  const hidden = field(body, "hidden") === "true";

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  await clients.setHidden(deps.db, id, hidden);
  await recordAudit(deps, auditFields(c, hidden ? "client.hide" : "client.unhide", client.email));
  return doneRedirect(
    c,
    body,
    "/admin/users",
    hidden ? "user.hidden" : "user.unhidden",
    client.email,
  );
}

export async function assignStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  const streamId = toId(field(body, "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);

  // Both ends must exist — a stale form otherwise turns into a foreign-key 500.
  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  const stream = await streams.getById(deps.db, streamId);
  if (stream === null) {
    return errorPage(
      c,
      400,
      "That channel no longer exists",
      "Nothing was changed — the channel has been deleted. Reload the page and pick another.",
      { href: returnTo(body) ?? `/admin/users/${id}`, label: "← Back" },
    );
  }

  await streams.assignUser(deps.db, id, streamId); // adding access never strands
  await recordAudit(
    deps,
    auditFields(c, "stream.assign", client.email, JSON.stringify({ streamId })),
  );
  return doneRedirect(c, body, `/admin/users/${id}`, "user.assigned", client.email);
}

export async function unassignStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  const streamId = toId(field(body, "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  const stream = await streams.getById(deps.db, streamId);
  const back = returnTo(body) ?? `/admin/users/${id}`;

  const action: AdminAction = { type: "unassign-user-stream", clientId: id, streamId };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/clients/${id}/streams/unassign`,
    { streamId: String(streamId), return_to: back },
    {
      subject: `Remove ${client.email} from ${stream?.name ?? "the channel"}`,
      cancelTo: back,
    },
  );
  if (blocked !== null) return blocked;

  await streams.unassignUser(deps.db, id, streamId);
  await recordAudit(
    deps,
    auditFields(c, "stream.unassign", client.email, JSON.stringify({ streamId })),
  );
  return doneRedirect(c, body, `/admin/users/${id}`, "user.unassigned", client.email);
}

export async function pinClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  const buildId = toId(field(body, "buildId"));
  if (id === null || buildId === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  // The build must exist — a dangling pin is accepted by the DB (no FK) and silently strands.
  const build = await builds.getById(deps.db, buildId);
  if (build === null) {
    return errorPage(
      c,
      400,
      "That build no longer exists",
      "Nothing was changed — reload the page and pick a build from the list.",
      { href: returnTo(body) ?? `/admin/users/${id}`, label: "← Back" },
    );
  }
  const back = returnTo(body) ?? `/admin/users/${id}`;

  const action: AdminAction = { type: "pin-client", clientId: id, buildId };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/clients/${id}/pin`,
    { buildId: String(buildId), return_to: back },
    { subject: `Pin ${client.email} to ${buildSubject(build)}`, cancelTo: back },
  );
  if (blocked !== null) return blocked;

  await clients.setPinnedBuild(deps.db, id, buildId);
  await recordAudit(deps, auditFields(c, "client.pin", client.email, JSON.stringify({ buildId })));
  return doneRedirect(c, body, `/admin/users/${id}`, "user.pinned", client.email);
}

export async function unpinClient(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const client = await clients.getById(deps.db, id);
  if (client === null) return c.text("Not found", 404);
  const back = returnTo(body) ?? `/admin/users/${id}`;

  // Unpinning can strand a user whose pinned build was their only servable target → §11 confirm.
  const action: AdminAction = { type: "unpin-client", clientId: id };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/clients/${id}/unpin`,
    { return_to: back },
    { subject: `Unpin ${client.email}`, cancelTo: back },
  );
  if (blocked !== null) return blocked;

  await clients.setPinnedBuild(deps.db, id, null);
  await recordAudit(deps, auditFields(c, "client.unpin", client.email));
  return doneRedirect(c, body, `/admin/users/${id}`, "user.unpinned", client.email);
}
