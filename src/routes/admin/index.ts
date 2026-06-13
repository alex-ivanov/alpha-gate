import { Hono } from "hono";
import { buildDeps, type Deps } from "../../deps";
import type { Env } from "../../env";
import type { AdminEnv } from "./admin-context";
import {
  assignStream,
  createClient,
  pinClient,
  reissueClient,
  revokeClient,
  unassignStream,
  unpinClient,
} from "./clients";
import { adminAuth } from "./middleware";
import {
  activityView,
  auditView,
  buildsView,
  dashboardView,
  streamsView,
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
  app.get("/admin/builds", buildsView);
  app.get("/admin/streams", streamsView);
  app.get("/admin/activity", activityView);
  app.get("/admin/audit", auditView);

  // Client mutations (§10/§13)
  app.post("/admin/clients", createClient);
  app.post("/admin/clients/:id/revoke", revokeClient);
  app.post("/admin/clients/:id/reissue", reissueClient);
  app.post("/admin/clients/:id/pin", pinClient);
  app.post("/admin/clients/:id/unpin", unpinClient);
  app.post("/admin/clients/:id/streams/assign", assignStream);
  app.post("/admin/clients/:id/streams/unassign", unassignStream);

  app.notFound((c) => c.text("Not found", 404));
  return app;
}
