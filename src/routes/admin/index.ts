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
import { createStream, deleteStream } from "./streams";
import { registerBuild, uploadBuild } from "./upload";
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

  // Channel mutations (§13)
  app.post("/admin/streams", createStream);
  app.post("/admin/streams/:id/delete", deleteStream);

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
  app.post("/admin/builds/:id/streams/link", linkBuildStream);
  app.post("/admin/builds/:id/streams/unlink", unlinkBuildStream);

  app.notFound((c) => c.text("Not found", 404));
  return app;
}
