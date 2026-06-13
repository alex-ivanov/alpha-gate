import { type ResolverResult, resolve } from "../../core/resolver";
import type { Client } from "../../core/types";
import { listAvailable, listBuildStreams } from "../../db/builds";
import { streamIdsForClient } from "../../db/streams";
import type { Deps } from "../../deps";

// Loads the slice the §8 resolver needs for one client and runs it. Shared by /appcast and /download
// so both serve exactly the same target. Passing only available builds is sufficient: a pin to a
// withdrawn build is then absent → resolver yields none (the no-build state), which is correct.
// Queries run sequentially — D1 dislikes concurrent statements on one session.
export async function resolveServed(deps: Deps, client: Client): Promise<ResolverResult> {
  const builds = await listAvailable(deps.db);
  const buildStreams = await listBuildStreams(deps.db);
  const clientStreamIds = await streamIdsForClient(deps.db, client.id);
  return resolve({ client, builds, buildStreams, clientStreamIds });
}
