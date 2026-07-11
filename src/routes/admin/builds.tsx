import type { AdminAction } from "../../core/no-build";
import * as builds from "../../db/builds";
import * as streams from "../../db/streams";
import { recordAudit } from "../../services/audit";
import { ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { guardStranding, guardStrandingBatch } from "./confirm";
import { buildSubject, doneRedirect } from "./flash";
import { field, idList, returnTo, toId } from "./form";
import { requireUser } from "./middleware";

// §9/§10/§11 — build mutations. Withdraw and remove-from-stream can strand users, so they run the
// §11 confirm flow (not blocked, confirmed). Restore, mark-critical, and link-to-stream only ever
// add capability, so they never strand. Each requires a human actor and records an audit row.
// Successes 303 back to the page the operator acted from (return_to) with a flash notice; a re-post
// that would change nothing (double submit, stale tab) is a flash no-op, not a phantom audit row.

async function loadBuild(c: AdminContext) {
  const id = toId(c.req.param("id"));
  if (id === null) return { id: null, build: null };
  const build = await builds.getById(c.get("deps").db, id);
  return { id, build };
}

function staleChannelPage(c: AdminContext, back: string): Response {
  return c.html(
    renderPage(
      <ResultPage
        title="That channel no longer exists"
        intent="error"
        back={{ href: back, label: "← Back" }}
      >
        <p>Nothing was changed — the channel has been deleted. Reload the page and pick another.</p>
      </ResultPage>,
    ),
    400,
  );
}

export async function withdrawBuild(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);
  if (build.status === "withdrawn") {
    return doneRedirect(
      c,
      body,
      "/admin/builds",
      "noop",
      `${buildSubject(build)} is already withdrawn.`,
    );
  }
  const back = returnTo(body) ?? "/admin/builds";

  const action: AdminAction = { type: "withdraw-build", buildId: id };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/builds/${id}/withdraw`,
    { return_to: back },
    { subject: `Withdraw ${buildSubject(build)}`, cancelTo: back },
  );
  if (blocked !== null) return blocked;

  await builds.setStatus(deps.db, id, "withdrawn");
  await recordAudit(deps, auditFields(c, "build.withdraw", String(build.buildNumber)));
  return doneRedirect(c, body, "/admin/builds", "build.withdrawn", buildSubject(build));
}

export async function restoreBuild(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);
  if (build.status === "available") {
    return doneRedirect(
      c,
      body,
      "/admin/builds",
      "noop",
      `${buildSubject(build)} is already available.`,
    );
  }

  await builds.setStatus(deps.db, id, "available"); // restoring never strands
  await recordAudit(deps, auditFields(c, "build.restore", String(build.buildNumber)));
  return doneRedirect(c, body, "/admin/builds", "build.restored", buildSubject(build));
}

export async function markCritical(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);

  const critical = field(body, "critical") === "true";
  if (build.critical === critical) {
    return doneRedirect(c, body, "/admin/builds", "noop");
  }
  await builds.setCritical(deps.db, id, critical);
  await recordAudit(
    deps,
    auditFields(c, "build.critical", String(build.buildNumber), JSON.stringify({ critical })),
  );
  return doneRedirect(
    c,
    body,
    "/admin/builds",
    critical ? "build.critical" : "build.uncritical",
    buildSubject(build),
  );
}

// Admin-list visibility: hide/unhide declutters the Builds list — it never changes whether the build
// serves (that's withdraw). Toggle via a hidden field, like critical/rollback.
export async function setBuildHidden(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const hidden = field(body, "hidden") === "true";
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);

  await builds.setHidden(deps.db, id, hidden);
  await recordAudit(
    deps,
    auditFields(c, hidden ? "build.hide" : "build.unhide", String(build.buildNumber)),
  );
  return doneRedirect(
    c,
    body,
    "/admin/builds",
    hidden ? "build.hidden" : "build.unhidden",
    buildSubject(build),
  );
}

// §9/§13 #7 — toggle the rollback-target marker. A label only (Sparkle can't downgrade; real rollback
// is a roll-forward, §9), so it never strands and needs no §11 gate.
export async function markRollbackTarget(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const { id, build } = await loadBuild(c);
  if (id === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);

  const rollbackTarget = field(body, "rollback") === "true";
  if (build.rollbackTarget === rollbackTarget) {
    return doneRedirect(c, body, "/admin/builds", "noop");
  }
  await builds.setRollbackTarget(deps.db, id, rollbackTarget);
  await recordAudit(
    deps,
    auditFields(c, "build.rollback", String(build.buildNumber), JSON.stringify({ rollbackTarget })),
  );
  return doneRedirect(
    c,
    body,
    "/admin/builds",
    rollbackTarget ? "build.rollback" : "build.unrollback",
    buildSubject(build),
  );
}

export async function linkBuildStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const { id, build } = await loadBuild(c);
  const streamId = toId(field(body, "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);
  const back = returnTo(body) ?? "/admin/builds";

  // Both ends must exist and the link must be new — a stale form otherwise turns into a raw
  // foreign-key or unique-constraint 500.
  if ((await streams.getById(deps.db, streamId)) === null) return staleChannelPage(c, back);
  const links = await builds.listBuildStreams(deps.db);
  if (links.some((l) => l.buildId === id && l.streamId === streamId)) {
    return doneRedirect(
      c,
      body,
      "/admin/builds",
      "noop",
      `${buildSubject(build)} is already in that channel.`,
    );
  }

  await builds.linkStream(deps.db, id, streamId); // adding to a channel never strands
  await recordAudit(
    deps,
    auditFields(c, "build.link", String(build.buildNumber), JSON.stringify({ streamId })),
  );
  return doneRedirect(c, body, "/admin/builds", "build.linked", buildSubject(build));
}

export async function unlinkBuildStream(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();
  const { id, build } = await loadBuild(c);
  const streamId = toId(field(body, "streamId"));
  if (id === null || streamId === null) return c.text("Bad request", 400);
  if (build === null) return c.text("Not found", 404);
  const back = returnTo(body) ?? "/admin/builds";
  const stream = await streams.getById(deps.db, streamId);

  const action: AdminAction = { type: "remove-build-from-stream", buildId: id, streamId };
  const blocked = await guardStranding(
    c,
    action,
    field(body, "confirm") === "true",
    `/admin/builds/${id}/streams/unlink`,
    { streamId: String(streamId), return_to: back },
    {
      subject: `Unlink ${buildSubject(build)} from ${stream?.name ?? "the channel"}`,
      cancelTo: back,
    },
  );
  if (blocked !== null) return blocked;

  await builds.unlinkStream(deps.db, id, streamId);
  await recordAudit(
    deps,
    auditFields(c, "build.unlink", String(build.buildNumber), JSON.stringify({ streamId })),
  );
  return doneRedirect(c, body, "/admin/builds", "build.unlinked", buildSubject(build));
}

// §13 #3 — apply one operation to several selected builds. Bulk withdraw can strand users, so it runs
// the §11 confirm over the COMBINED effect (one confirmation for the whole selection); mark/clear
// critical only adds capability and never strands. Repeated `id` fields → parseBody({ all: true }).
export async function bulkBuilds(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody({ all: true });
  const op = field(body, "op");
  const ids = idList(body, "id");
  if (op === null) return c.text("A bulk operation is required", 400);
  if (ids.length === 0) {
    return doneRedirect(c, body, "/admin/builds", "bulk.none"); // nothing selected → say so
  }
  const subject = `${ids.length} ${ids.length === 1 ? "build" : "builds"}`;

  if (op === "withdraw") {
    const actions: AdminAction[] = ids.map((buildId) => ({ type: "withdraw-build", buildId }));
    const blocked = await guardStrandingBatch(
      c,
      actions,
      field(body, "confirm") === "true",
      "/admin/builds/bulk",
      "withdraw",
      ids,
    );
    if (blocked !== null) return blocked;
    for (const id of ids) {
      const build = await builds.getById(deps.db, id);
      if (build === null || build.status === "withdrawn") continue; // no phantom audit rows
      await builds.setStatus(deps.db, id, "withdrawn");
      await recordAudit(deps, auditFields(c, "build.withdraw", String(build.buildNumber)));
    }
    return doneRedirect(c, body, "/admin/builds", "bulk.withdrawn", subject);
  }

  if (op === "critical" || op === "uncritical") {
    const critical = op === "critical";
    for (const id of ids) {
      const build = await builds.getById(deps.db, id);
      if (build === null || build.critical === critical) continue; // no phantom audit rows
      await builds.setCritical(deps.db, id, critical);
      await recordAudit(
        deps,
        auditFields(c, "build.critical", String(build.buildNumber), JSON.stringify({ critical })),
      );
    }
    return doneRedirect(
      c,
      body,
      "/admin/builds",
      critical ? "bulk.critical" : "bulk.uncritical",
      subject,
    );
  }

  return c.text("Unknown bulk operation", 400);
}
