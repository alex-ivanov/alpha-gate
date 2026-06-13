import { runScheduled } from "./cron";
import { type Env, readEnv } from "./env";
import { createAdminApp } from "./routes/admin";
import { createAppApp } from "./routes/app";

// §17 — the single entrypoint, deployed twice and switched by env.ROLE. The app/admin Hono apps are
// built once at module scope; fetch dispatches to one by role, scheduled() runs the cron (admin only).
// This is the only file that knows about both surfaces; it holds no logic of its own.

const appWorker = createAppApp();
const adminWorker = createAdminApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    readEnv(env); // fail fast on a misconfigured ROLE
    const worker = env.ROLE === "admin" ? adminWorker : appWorker;
    return worker.fetch(request, env, ctx);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduled(env));
  },
};
