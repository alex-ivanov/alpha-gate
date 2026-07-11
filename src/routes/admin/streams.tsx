import type { AdminAction } from "../../core/no-build";
import { create, getById, getByName, remove } from "../../db/streams";
import { recordAudit } from "../../services/audit";
import { ConfirmActionPage, ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { strandingPreview } from "./confirm";
import { doneRedirect } from "./flash";
import { field, returnTo, toId } from "./form";
import { requireUser } from "./middleware";

// §13 — channel (stream) create/delete. Human-only. Deleting a channel silently unassigns its users
// and unlinks its builds — destructive even when nobody is stranded — so it is ALWAYS confirmed, with
// the §11 stranded-users list embedded in the confirmation when there is one.

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
