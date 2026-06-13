import type { AuditFields } from "../../core/audit-chain";
import type { AdminContext } from "./admin-context";

// Builds the audited content of a mutation from the verified actor (never a raw header) plus request
// metadata. The route layer owns this (it knows the Hono context); services/audit stays Hono-free.
export function auditFields(
  c: AdminContext,
  action: string,
  target: string | null = null,
  detail: string | null = null,
): AuditFields {
  const actor = c.get("actor");
  return {
    actorEmail: actor.kind === "user" ? actor.email : actor.commonName,
    action,
    target,
    detail,
    ip: c.req.header("cf-connecting-ip") ?? null,
    rayId: c.req.header("cf-ray") ?? null,
    createdAt: c.get("deps").clock(),
  };
}
