// The typed contract for the §18 wrangler `[vars]` and bindings. Both Workers (app + admin) share
// this shape, switched at runtime by `ROLE`. Declared on the global `Cloudflare.Env` so the
// `cloudflare:test` runtime `env` is typed identically to production.
//
// A defensive `readEnv()` guard is added in M7 when the runtime code that consumes these lands; for
// now this file is the type-only source of truth.

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
    }
  }
}

export type Env = Cloudflare.Env;
