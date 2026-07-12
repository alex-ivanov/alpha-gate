// The typed contract for the §18 wrangler `[vars]` and bindings. Both Workers (app + admin) share
// this shape, switched at runtime by `ROLE`. Declared on the global `Cloudflare.Env` so the
// `cloudflare:test` runtime `env` is typed identically to production.
//
// `readEnv()` below is the defensive guard: it fails fast on a misconfigured `ROLE`.

export type Role = "app" | "admin";
export type EmailProvider = "none" | "cloudflare";

declare global {
  namespace Cloudflare {
    interface Env {
      // Bindings (§18)
      DB: D1Database;
      BUILDS: R2Bucket;

      // Vars (§18)
      INSTANCE: string;
      ROLE: Role;
      EMAIL_PROVIDER: EmailProvider;
      EMAIL_FROM: string;
      TOOL_VERSION: string;
      UPDATE_MANIFEST_URL: string;

      // Admin-only, set after Cloudflare Access is enabled (§19). Absent on the app Worker.
      ACCESS_TEAM_DOMAIN?: string;
      ACCESS_AUD?: string;

      // Cloudflare Email Service binding (§24). Rendered onto the admin Worker only, and only when
      // EMAIL_PROVIDER="cloudflare"; absent otherwise (delivery falls back to copy-paste).
      EMAIL?: SendEmail;
    }
  }
}

export type Env = Cloudflare.Env;

/**
 * Defensive read of the runtime env: fails fast on a misconfigured Worker (e.g. a ROLE that isn't
 * "app"/"admin") rather than mis-routing silently. Returns the same object, narrowed.
 */
export function readEnv(env: Env): Env {
  if (env.ROLE !== "app" && env.ROLE !== "admin") {
    throw new Error(`Invalid ROLE: ${String(env.ROLE)} (expected "app" or "admin")`);
  }
  return env;
}
