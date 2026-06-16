import type { AdminAction } from "../../core/no-build";
import { create, getByName, remove } from "../../db/streams";
import { recordAudit } from "../../services/audit";
import { ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { guardStranding } from "./confirm";
import { field, toId } from "./form";
import { requireUser } from "./middleware";

// §13 — channel (stream) create/delete. Human-only. Deleting a channel unassigns its users and
// unlinks its builds, which can strand users → the §11 confirm gate applies.

export async function createStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const raw = field(await c.req.parseBody(), "name");
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
  return c.redirect("/admin/streams", 303);
}

export async function deleteStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  if (id === null) return c.text("Bad request", 400);

  const action: AdminAction = { type: "delete-stream", streamId: id };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/streams/${id}/delete`,
    {},
  );
  if (blocked !== null) return blocked;

  await remove(deps.db, id);
  await recordAudit(deps, auditFields(c, "stream.delete", String(id)));
  return c.redirect("/admin/streams", 303);
}
