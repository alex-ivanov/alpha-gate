import { resolve } from "./resolver";
import type { Build, BuildStreamLink, Client, ResolverResult, UserStreamLink } from "./types";

// §11 — servability and the no-build state, sharing the §8 resolver so the confirmation preview and
// runtime resolution can never disagree (a bug here would silently strand users). Pure over plain
// data; the installed-build numbers come from the access log (the impure source is the caller's).

/** The relational slice the §11 computations operate on. */
export interface World {
  clients: readonly Client[];
  builds: readonly Build[];
  buildStreams: readonly BuildStreamLink[];
  userStreams: readonly UserStreamLink[];
}

/** A proposed admin mutation whose blast radius §11 wants computed before it is applied. */
export type AdminAction =
  | { type: "withdraw-build"; buildId: number }
  | { type: "restore-build"; buildId: number }
  | { type: "remove-build-from-stream"; buildId: number; streamId: number }
  | { type: "unassign-user-stream"; clientId: number; streamId: number }
  | { type: "pin-client"; clientId: number; buildId: number }
  | { type: "unpin-client"; clientId: number }
  | { type: "delete-stream"; streamId: number };

export type NoBuildState = "servable" | "empty" | "stranded";

/** The /appcast notion of servable: the resolver yields a target. Sparkle enforces no-downgrade itself. */
export function isServableResult(result: ResolverResult): boolean {
  return result.kind === "target";
}

export function resolveForClient(world: World, client: Client): ResolverResult {
  const clientStreamIds = world.userStreams
    .filter((link) => link.clientId === client.id)
    .map((link) => link.streamId);
  return resolve({
    client,
    builds: world.builds,
    buildStreams: world.buildStreams,
    clientStreamIds,
  });
}

/**
 * The §13 admin-surface notion, which accounts for no-downgrade using the client's last-reported
 * installed build (or null if unknown):
 * - `servable`  — the resolver yields a target the client can actually be on (≥ installed).
 * - `stranded`  — the client is on a withdrawn build and the resolver can't move them higher (§11).
 * - `empty`     — no usable build otherwise (no streams/builds, or pinned to a withdrawn build).
 */
export function noBuildState(
  world: World,
  client: Client,
  installedBuildNumber: number | null,
): NoBuildState {
  const result = resolveForClient(world, client);
  const target = result.kind === "target" ? result.build : null;

  const servable =
    target !== null &&
    (installedBuildNumber === null || target.buildNumber >= installedBuildNumber);
  if (servable) return "servable";

  // §11 files "pinned to a now-withdrawn build" under EMPTY — the pin is the cause, so classify as
  // empty regardless of the installed build. Must precede the stranded (stream no-downgrade) check.
  if (client.pinnedBuildId !== null) {
    const pinned = world.builds.find((build) => build.id === client.pinnedBuildId);
    if (pinned === undefined || pinned.status !== "available") return "empty";
  }

  const onWithdrawnBuild =
    installedBuildNumber !== null &&
    world.builds.some(
      (build) => build.buildNumber === installedBuildNumber && build.status === "withdrawn",
    );
  return onWithdrawnBuild ? "stranded" : "empty";
}

/**
 * The emails of clients who are servable now but would fall into the no-build state if the batch of
 * `actions` were applied together. §11: such actions are confirmed, not blocked — the §13 #3 bulk
 * withdraw shows the union of everyone the whole selection would strand, so the operator confirms
 * once for the lot (single actions pass a one-element batch).
 */
export function computeAffectedUsersForActions(
  world: World,
  actions: readonly AdminAction[],
  installed: ReadonlyMap<number, number> = new Map(),
): string[] {
  const after = applyActions(world, actions);
  const affected: string[] = [];

  for (const client of world.clients) {
    const installedBuildNumber = installed.get(client.id) ?? null;
    if (noBuildState(world, client, installedBuildNumber) !== "servable") continue;

    const clientAfter = after.clients.find((candidate) => candidate.id === client.id) ?? client;
    if (noBuildState(after, clientAfter, installedBuildNumber) !== "servable") {
      affected.push(client.email);
    }
  }
  return affected;
}

/** Fold a sequence of actions into the world (the bulk operations apply several at once). */
function applyActions(world: World, actions: readonly AdminAction[]): World {
  return actions.reduce(applyAction, world);
}

/** Pure transform: a new World with `action` applied. */
function applyAction(world: World, action: AdminAction): World {
  switch (action.type) {
    case "withdraw-build":
      return { ...world, builds: withBuildStatus(world.builds, action.buildId, "withdrawn") };
    case "restore-build":
      return { ...world, builds: withBuildStatus(world.builds, action.buildId, "available") };
    case "remove-build-from-stream":
      return {
        ...world,
        buildStreams: world.buildStreams.filter(
          (link) => !(link.buildId === action.buildId && link.streamId === action.streamId),
        ),
      };
    case "unassign-user-stream":
      return {
        ...world,
        userStreams: world.userStreams.filter(
          (link) => !(link.clientId === action.clientId && link.streamId === action.streamId),
        ),
      };
    case "pin-client":
      return { ...world, clients: withPin(world.clients, action.clientId, action.buildId) };
    case "unpin-client":
      return { ...world, clients: withPin(world.clients, action.clientId, null) };
    case "delete-stream":
      // The channel and all its assignments/links vanish: builds leave it, users are unassigned.
      return {
        ...world,
        buildStreams: world.buildStreams.filter((link) => link.streamId !== action.streamId),
        userStreams: world.userStreams.filter((link) => link.streamId !== action.streamId),
      };
  }
}

function withBuildStatus(
  builds: readonly Build[],
  buildId: number,
  status: Build["status"],
): Build[] {
  return builds.map((build) => (build.id === buildId ? { ...build, status } : build));
}

function withPin(
  clients: readonly Client[],
  clientId: number,
  pinnedBuildId: number | null,
): Client[] {
  return clients.map((client) => (client.id === clientId ? { ...client, pinnedBuildId } : client));
}
