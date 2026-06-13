import type { Build, BuildStreamLink, Client, ResolverResult } from "./types";

// §8 — the core resolver. Pure: given a client (or null for an unknown token), the builds, the
// build→stream links, and the client's stream assignments, decide what to serve. The single source
// of truth behind /appcast, the /download target, and the §11 no-build preview, so the confirmation
// preview and runtime resolution can never disagree.

export interface ResolveInput {
  /** The client for the token, or null when the token matched no row (§3/§15). */
  client: Client | null;
  /** Candidate builds (the resolver filters by status and stream membership). */
  builds: readonly Build[];
  /** build_streams rows for the candidate builds. */
  buildStreams: readonly BuildStreamLink[];
  /** The stream ids this client is assigned to (their user_streams rows). */
  clientStreamIds: readonly number[];
}

export type { ResolverResult } from "./types";

export function resolve(input: ResolveInput): ResolverResult {
  const { client, builds, buildStreams, clientStreamIds } = input;

  // 1. Unknown or revoked → an informational notice, never a target (§8.1, §15).
  if (client === null) return { kind: "informational", reason: "unknown" };
  if (client.status === "revoked") return { kind: "informational", reason: "revoked" };

  // 2. A pin overrides stream resolution entirely (§8.2). If the pinned build is unavailable
  //    (withdrawn or gone) the client is no-build — it does NOT fall back to streams (§11).
  if (client.pinnedBuildId !== null) {
    const pinned = builds.find((build) => build.id === client.pinnedBuildId);
    if (pinned !== undefined && pinned.status === "available") {
      return { kind: "target", build: pinned };
    }
    return { kind: "none" };
  }

  // 3. Otherwise: the highest available build_number across the client's streams (§8.3).
  const target = highestAvailableInStreams(builds, buildStreams, clientStreamIds);
  return target === null ? { kind: "none" } : { kind: "target", build: target };
}

function highestAvailableInStreams(
  builds: readonly Build[],
  buildStreams: readonly BuildStreamLink[],
  clientStreamIds: readonly number[],
): Build | null {
  const clientStreams = new Set(clientStreamIds);
  const buildIdsInClientStreams = new Set(
    buildStreams.filter((link) => clientStreams.has(link.streamId)).map((link) => link.buildId),
  );

  let best: Build | null = null;
  for (const build of builds) {
    if (build.status !== "available") continue;
    if (!buildIdsInClientStreams.has(build.id)) continue;
    if (best === null || build.buildNumber > best.buildNumber) best = build;
  }
  return best;
}
