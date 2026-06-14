import type { AdminAction } from "../../core/no-build";
import { create, remove } from "../../db/streams";
import { recordAudit } from "../../services/audit";
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
  const name = field(await c.req.parseBody(), "name");
  if (name === null) return c.text("A channel name is required", 400);

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
