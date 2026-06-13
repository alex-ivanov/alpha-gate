import { Hono } from "hono";
import { buildDeps, type Deps } from "../../deps";
import type { Env } from "../../env";
import { accessRoute } from "./access";
import type { AppEnv } from "./app-context";
import { appcastRoute } from "./appcast";
import { assetsRoute } from "./assets";
import { downloadRoute } from "./download";
import { getRoute } from "./get";

// The public App Worker surface (ROLE=app). /appcast is added in M10. There are no admin routes here,
// so any /admin/* path falls through to the generic 404 — there is no ungated admin surface.
// depsFor is injectable so tests swap seams (clock, and later access/email).
export function createAppApp(depsFor: (env: Env) => Deps = buildDeps) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", depsFor(c.env));
    await next();
  });

  app.get("/get", getRoute);
  app.get("/appcast", appcastRoute);
  app.get("/download", downloadRoute);
  app.get("/assets/:name", assetsRoute);
  app.get("/access", accessRoute);

  app.notFound((c) => c.text("Not found", 404));
  return app;
}
