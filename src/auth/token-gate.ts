import { isWellFormedToken, normalizeToken } from "../core/tokens";
import type { Client } from "../core/types";
import { findByToken } from "../db/clients";
import type { Deps } from "../deps";

// The public-side token gate used by every /get, /appcast, /download request. Validates shape, then
// looks the client up by the normalized token. Returns the client for active AND revoked rows (the
// resolver and routes decide what each gets); an unknown/malformed token is indistinguishable from a
// revoked one to the outside, so token existence is never confirmed (§6/§16).

export type GateResult =
  | { kind: "active"; client: Client }
  | { kind: "revoked"; client: Client }
  | { kind: "unknown" };

export async function gateToken(
  deps: Deps,
  rawToken: string | null | undefined,
): Promise<GateResult> {
  if (rawToken === null || rawToken === undefined || !isWellFormedToken(rawToken)) {
    return { kind: "unknown" };
  }

  const client = await findByToken(deps.db, normalizeToken(rawToken));
  if (client === null) return { kind: "unknown" };
  return client.status === "revoked" ? { kind: "revoked", client } : { kind: "active", client };
}
