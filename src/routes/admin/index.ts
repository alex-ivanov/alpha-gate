import { Hono } from "hono";
import { buildDeps, type Deps } from "../../deps";
import type { Env } from "../../env";
import type { AdminEnv } from "./admin-context";
import { saveBranding, sendTestEmail } from "./branding";
import {
  bulkBuilds,
  linkBuildStream,
  markCritical,
  markRollbackTarget,
  purgeArchive,
  restoreBuild,
  setBuildHidden,
  unlinkBuildStream,
  withdrawBuild,
} from "./builds";
import {
  assignStream,
  createClient,
  pinClient,
  reactivateClient,
  reissueClient,
  revokeClient,
  setClientHidden,
  unassignStream,
  unpinClient,
} from "./clients";
import { adminAuth } from "./middleware";
import { dismissPending, invitePending } from "./pending";
import { assignUsersToStream, createStream, deleteStream, linkBuildsToStream } from "./streams";
import { setTheme } from "./theme";
import { publishInfo, registerBuild, uploadBuild } from "./upload";
import {
  activityView,
  auditView,
  buildManageView,
  buildsView,
  ciView,
  dashboardView,
  pendingView,
  settingsView,
  setupView,
  streamManageView,
  streamsView,
  uploadView,
  userManageView,
  usersView,
} from "./views";

// The gated Admin Worker surface (ROLE=admin). EVERY request passes through adminAuth from one mount,
// so no route can forget verification. Public paths (/get, /appcast, …) aren't mounted → 404. Read
// views and mutations are added in M12+. depsFor is injectable so tests swap the Access verifier.
export function createAdminApp(depsFor: (env: Env) => Deps = buildDeps) {
  const app = new Hono<AdminEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", depsFor(c.env));
    await next();
  });
  app.use("*", adminAuth);

  // Decision 0006 enforced globally, not just on mutations: a service token may reach ONLY the
  // publish surface. Reads matter too — user pages render live invite links, so a leaked CI
  // credential must not be able to browse the back office.
  const serviceAllowed = new Set([
    "/admin/builds/upload",
    "/admin/builds/register",
    "/admin/publish-info",
  ]);
  app.use("*", async (c, next) => {
    const actor = c.get("actor");
    if (actor.kind === "service" && !serviceAllowed.has(new URL(c.req.url).pathname)) {
      return c.text("Forbidden — service tokens may only publish (decision 0006)", 403);
    }
    await next();
  });

  // The deploy output and onboarding hand out the bare admin origin — route it home instead of 404.
  app.get("/", (c) => c.redirect("/admin", 302));

  app.get("/admin", dashboardView);
  app.get("/admin/users", usersView);
  app.get("/admin/users/:id", userManageView);
  app.get("/admin/builds", buildsView);
  app.get("/admin/builds/:id", buildManageView);
  app.get("/admin/streams", streamsView);
  app.get("/admin/streams/:id", streamManageView);
  app.get("/admin/pending", pendingView);
  app.get("/admin/upload", uploadView);
  app.get("/admin/ci", ciView);
  app.get("/admin/setup", setupView);
  app.get("/admin/settings", settingsView);
  app.get("/admin/activity", activityView);
  app.get("/admin/audit", auditView);

  // Read-only publish helper (service-token allowed, decision 0006): top build + channels + caps,
  // so a publish script pre-checks locally instead of failing after a full upload.
  app.get("/admin/publish-info", publishInfo);

  // UI preference (theme toggle) — human only, not audited (no domain change)
  app.post("/admin/theme", setTheme);

  // Channel mutations (§13). The :id/link and :id/assign batch routes serve the channel page's
  // multi-select pickers (repeated buildId/clientId fields); both are additive and never strand.
  app.post("/admin/streams", createStream);
  app.post("/admin/streams/:id/delete", deleteStream);
  app.post("/admin/streams/:id/link", linkBuildsToStream);
  app.post("/admin/streams/:id/assign", assignUsersToStream);

  // Pending access requests (§13 #10)
  app.post("/admin/pending/:id/invite", invitePending);
  app.post("/admin/pending/:id/dismiss", dismissPending);

  // Client mutations (§10/§13)
  app.post("/admin/clients", createClient);
  app.post("/admin/clients/:id/revoke", revokeClient);
  app.post("/admin/clients/:id/reactivate", reactivateClient);
  app.post("/admin/clients/:id/reissue", reissueClient);
  app.post("/admin/clients/:id/pin", pinClient);
  app.post("/admin/clients/:id/unpin", unpinClient);
  app.post("/admin/clients/:id/streams/assign", assignStream);
  app.post("/admin/clients/:id/streams/unassign", unassignStream);
  app.post("/admin/clients/:id/hidden", setClientHidden);

  // Publish (§20) — service tokens accepted here only (decision 0006)
  app.post("/admin/builds/upload", uploadBuild);
  app.post("/admin/builds/register", registerBuild);
  // Branding + invite template (§13) — human only
  app.post("/admin/branding", saveBranding);
  app.post("/admin/settings/test-email", sendTestEmail);

  // Build mutations (§9/§10/§11). The literal /bulk is mounted before the :id forms (no collision —
  // distinct paths — but kept adjacent to the per-build mutations it batches).
  app.post("/admin/builds/bulk", bulkBuilds);
  app.post("/admin/builds/:id/withdraw", withdrawBuild);
  app.post("/admin/builds/:id/restore", restoreBuild);
  app.post("/admin/builds/:id/critical", markCritical);
  app.post("/admin/builds/:id/rollback", markRollbackTarget);
  app.post("/admin/builds/:id/hidden", setBuildHidden);
  app.post("/admin/builds/:id/purge-archive", purgeArchive);
  app.post("/admin/builds/:id/streams/link", linkBuildStream);
  app.post("/admin/builds/:id/streams/unlink", unlinkBuildStream);

  app.notFound((c) => c.text("Not found", 404));
  return app;
}
