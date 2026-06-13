import type { MiddlewareHandler } from "hono";
import type { AdminContext, AdminEnv } from "./admin-context";

// §4 — the single auth mount for every admin request. Verifies the Access JWT and fails CLOSED (403)
// on any rejection; the verified actor is attached for downstream authorization and audit.
export const adminAuth: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const result = await c.get("deps").access.verify(c.req.raw.headers);
  if (result.kind === "reject") {
    return c.text("Forbidden", 403);
  }
  c.set("actor", result);
  await next();
};

/**
 * Restricts a route to a human admin (email JWT), rejecting service tokens. Mutation handlers call
 * this; only build upload/register (M15) accept a service token (decision 0006 — bounds a leaked CI
 * credential to publishing). Returns the actor email, or null if a service token must be refused.
 */
export function requireUser(c: AdminContext): { email: string } | null {
  const actor = c.get("actor");
  return actor.kind === "user" ? { email: actor.email } : null;
}
