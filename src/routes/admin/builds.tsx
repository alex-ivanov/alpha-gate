import type { AdminAction } from "../../core/no-build";
import * as builds from "../../db/builds";
import { recordAudit } from "../../services/audit";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { guardStranding } from "./confirm";
import { field, toId } from "./form";
import { requireUser } from "./middleware";

// §9/§10/§11 — build mutations. Withdraw and remove-from-stream can strand users, so they run the
// §11 confirm flow (not blocked, confirmed). Restore, mark-critical, and link-to-stream only ever
// add capability, so they never strand. Each requires a human actor and records an audit row.

async function loadBuild(c: AdminContext) {
  const id = toId(c.req.param("id"));
  if (id === null) return { id: null, build: null };
  const build = await builds.getById(c.get("deps").db, id);
  return { id, build };
}

export async function withdrawBuild(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);

  const action: AdminAction = { type: "withdraw-build", buildId: id };
  const confirmed = field(await c.req.parseBody(), "confirm") === "true";
  const blocked = await guardStranding(c, action, confirmed, `/admin/builds/${id}/withdraw`, {});
  if (blocked !== null) return blocked;

  await builds.setStatus(deps.db, id, "withdrawn");
  await recordAudit(deps, auditFields(c, "build.withdraw", String(build.buildNumber)));
  return c.redirect("/admin/builds", 303);
}

export async function restoreBuild(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);

  await builds.setStatus(deps.db, id, "available"); // restoring never strands
  await recordAudit(deps, auditFields(c, "build.restore", String(build.buildNumber)));
  return c.redirect("/admin/builds", 303);
}

export async function markCritical(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);

  const critical = field(body, "critical") === "true";
  await builds.setCritical(deps.db, id, critical);
  await recordAudit(
    deps,
    auditFields(c, "build.critical", String(build.buildNumber), JSON.stringify({ critical })),
  );
  return c.redirect("/admin/builds", 303);
}

export async function linkBuildStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  const streamId = toId(field(await c.req.parseBody(), "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);

  await builds.linkStream(deps.db, id, streamId); // adding to a channel never strands
  await recordAudit(deps, auditFields(c, "build.link", String(id), JSON.stringify({ streamId })));
  return c.redirect("/admin/builds", 303);
}

export async function unlinkBuildStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const id = toId(c.req.param("id"));
  const streamId = toId(field(body, "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);

  const action: AdminAction = { type: "remove-build-from-stream", buildId: id, streamId };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/builds/${id}/streams/unlink`,
    { streamId: String(streamId) },
  );
  if (blocked !== null) return blocked;

  await builds.unlinkStream(deps.db, id, streamId);
  await recordAudit(deps, auditFields(c, "build.unlink", String(id), JSON.stringify({ streamId })));
  return c.redirect("/admin/builds", 303);
}
