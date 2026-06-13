import { Hono } from "hono";
import { buildDeps, type Deps } from "../../deps";
import type { Env } from "../../env";
import type { AdminEnv } from "./admin-context";
import { adminAuth } from "./middleware";

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

  // Placeholder authenticated route; replaced by the real dashboard/read views in M12.
  app.get("/admin", (c) => c.text("admin ok"));

  app.notFound((c) => c.text("Not found", 404));
  return app;
}
