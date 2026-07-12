import type { MiddlewareHandler } from "hono";
import type { AdminContext, AdminEnv } from "./admin-context";

// §4 — the single auth mount for every admin request. Verifies the Access JWT and fails CLOSED (403)
// on any rejection; the verified actor is attached for downstream authorization and audit.
//
// Reason disclosure is careful: when NO JWT header is present, the request never passed edge Access,
// so we reveal nothing (bare 403 — an attacker probing the origin learns only "denied"). When a JWT
// IS present but fails verification, the caller already holds a team-issued token, so naming the
// category (stale AUD after recreating the Access app, expired session, wrong team) turns the most-
// cited support issue — a mystery 403 the operator debugs via the troubleshooting doc — into a
// self-explaining page, without leaking anything a token-holder couldn't already infer.
export const adminAuth: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const result = await c.get("deps").access.verify(c.req.raw.headers);
  if (result.kind === "reject") {
    const presented = c.req.raw.headers.has("Cf-Access-Jwt-Assertion");
    if (!presented) return c.text("Forbidden", 403);
    return c.text(rejectionHelp(result.reason), 403);
  }
  c.set("actor", result);
  await next();
};

/** A short operator-facing explanation + fix for a verification failure, keyed off its reason. */
function rejectionHelp(reason: string): string {
  const r = reason.toLowerCase();
  const fix =
    "Re-run: ./deploy/deploy.sh --instance <slug> --access-team-domain <team> --access-aud <aud>";
  if (r.includes("aud")) {
    return `Access rejected: the token's audience doesn't match this Worker's configured AUD. This usually means the Access application was deleted and recreated (new AUD). ${fix}`;
  }
  if (r.includes("iss") || r.includes("team")) {
    return `Access rejected: the token's issuer doesn't match the configured team domain — likely a renamed Zero Trust team. ${fix.replace("<aud>", "<same aud>")}`;
  }
  if (r.includes("exp") || r.includes("expired")) {
    return "Access rejected: your session token expired. Reload this page to get a fresh one.";
  }
  if (r.includes("secret") || r.includes("unset") || r.includes("not configured")) {
    return `Access rejected: this admin Worker has no Access secrets set, so it fails closed. ${fix}`;
  }
  return `Access rejected (${reason}). If the Access application was recently changed, re-wire it: ${fix}`;
}

/**
 * Restricts a route to a human admin (email JWT), rejecting service tokens. Mutation handlers call
 * this; only build upload/register (M15) accept a service token (decision 0006 — bounds a leaked CI
 * credential to publishing). Returns the actor email, or null if a service token must be refused.
 */
export function requireUser(c: AdminContext): { email: string } | null {
  const actor = c.get("actor");
  return actor.kind === "user" ? { email: actor.email } : null;
}
