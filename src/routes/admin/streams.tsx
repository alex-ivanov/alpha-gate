import type { AdminAction } from "../../core/no-build";
import * as builds from "../../db/builds";
import * as clients from "../../db/clients";
import { assignUser, create, getById, getByName, listUserStreams, remove } from "../../db/streams";
import { recordAudit } from "../../services/audit";
import { ConfirmActionPage, ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { strandingPreview } from "./confirm";
import { doneRedirect } from "./flash";
import { field, idList, returnTo, toId } from "./form";
import { requireUser } from "./middleware";

// §13 — channel (stream) create/delete plus the channel page's batch attach routes (link several
// builds / assign several users in one POST — the multi-select combobox posts repeated ids; the
// no-JS fallback posts one). Both are purely additive, so they never strand and need no §11 gate.
// Deleting a channel silently unassigns its users and unlinks its builds — destructive even when
// nobody is stranded — so it is ALWAYS confirmed, with the §11 stranded-users list embedded.

export async function createStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const raw = field(body, "name");
  const name = raw === null ? null : raw.trim();
  if (name === null || name.length === 0) return c.text("A channel name is required", 400);

  // name is UNIQUE; pre-check so a duplicate is a clear 409, not the DB constraint's bare 500
  // (mirrors createClient / build upload).
  if ((await getByName(deps.db, name)) !== null) {
    return c.html(
      renderPage(
        <ResultPage
          title="Channel already exists"
          intent="error"
          back={{ href: "/admin/streams", label: "← Channels" }}
        >
          <p>
            A channel named <strong>{name}</strong> already exists.
          </p>
        </ResultPage>,
      ),
      409,
    );
  }

  const stream = await create(deps.db, name);
  await recordAudit(deps, auditFields(c, "stream.create", name, JSON.stringify({ id: stream.id })));
  return doneRedirect(c, body, "/admin/streams", "channel.created", name);
}

/** POST /admin/streams/:id/link — link the selected build(s) to this channel (additive, no §11). */
export async function linkBuildsToStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);
  const stream = await getById(deps.db, id);
  if (stream === null) return c.text("Not found", 404);

  const body = await c.req.parseBody({ all: true });
  const ids = idList(body, "buildId");
  if (ids.length === 0) {
    return doneRedirect(c, body, `/admin/streams/${id}`, "noop", "No builds were selected.");
  }

  const links = await builds.listBuildStreams(deps.db);
  let linked = 0;
  for (const buildId of ids) {
    const build = await builds.getById(deps.db, buildId);
    if (build === null) continue; // vanished under a stale form — skip, count honestly
    if (links.some((l) => l.buildId === buildId && l.streamId === id)) continue; // already here
    await builds.linkStream(deps.db, buildId, id);
    await recordAudit(
      deps,
      auditFields(c, "build.link", String(build.buildNumber), JSON.stringify({ streamId: id })),
    );
    linked++;
  }
  if (linked === 0) {
    return doneRedirect(
      c,
      body,
      `/admin/streams/${id}`,
      "noop",
      "Nothing to link — already in the channel or no longer available.",
    );
  }
  return doneRedirect(
    c,
    body,
    `/admin/streams/${id}`,
    "channel.builds-linked",
    `${linked} ${linked === 1 ? "build" : "builds"} into ${stream.name}`,
  );
}

/** POST /admin/streams/:id/assign — assign the selected user(s) to this channel (additive, no §11). */
export async function assignUsersToStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);
  const stream = await getById(deps.db, id);
  if (stream === null) return c.text("Not found", 404);

  const body = await c.req.parseBody({ all: true });
  const ids = idList(body, "clientId");
  if (ids.length === 0) {
    return doneRedirect(c, body, `/admin/streams/${id}`, "noop", "No users were selected.");
  }

  const memberships = await listUserStreams(deps.db);
  let assigned = 0;
  for (const clientId of ids) {
    const client = await clients.getById(deps.db, clientId);
    if (client === null) continue; // vanished under a stale form — skip, count honestly
    if (memberships.some((m) => m.clientId === clientId && m.streamId === id)) continue;
    await assignUser(deps.db, clientId, id);
    await recordAudit(
      deps,
      auditFields(c, "stream.assign", client.email, JSON.stringify({ streamId: id })),
    );
    assigned++;
  }
  if (assigned === 0) {
    return doneRedirect(
      c,
      body,
      `/admin/streams/${id}`,
      "noop",
      "Nothing to assign — already in the channel or no longer exist.",
    );
  }
  return doneRedirect(
    c,
    body,
    `/admin/streams/${id}`,
    "channel.users-assigned",
    `${assigned} ${assigned === 1 ? "user" : "users"} to ${stream.name}`,
  );
}

export async function deleteStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const stream = await getById(deps.db, id);
  if (stream === null) return c.text("Not found", 404);
  const back = returnTo(body) ?? "/admin/streams";

  if (field(body, "confirm") !== "true") {
    const action: AdminAction = { type: "delete-stream", streamId: id };
    const preview = await strandingPreview(c, action);
    if (!preview.ok) return preview.response;
    return c.html(
      renderPage(
        <ConfirmActionPage
          subject={`Delete the ${stream.name} channel`}
          confirmLabel="Delete channel"
          postTo={`/admin/streams/${id}/delete`}
          hidden={{ confirm: "true", return_to: back }}
          cancelTo={back}
          affected={preview.affected}
        >
          <p class="muted">
            Every user assigned to it is unassigned and every build linked to it is unlinked. The
            users and builds themselves are kept.
          </p>
        </ConfirmActionPage>,
      ),
    );
  }

  await remove(deps.db, id);
  await recordAudit(deps, auditFields(c, "stream.delete", stream.name));
  return doneRedirect(c, body, "/admin/streams", "channel.deleted", stream.name);
}
