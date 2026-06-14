import type { AuditRow } from "../../core/audit-chain";
import { type NoBuildState, noBuildState, type World } from "../../core/no-build";
import type { Build, Client, Stream } from "../../core/types";
import { type AccessLogEntry, countByBuild, currentBuild, recent } from "../../db/access-log";
import { listInOrder } from "../../db/admin-audit";
import { getById as getBuildById, listAll, listAvailable, listBuildStreams } from "../../db/builds";
import { getById as getClientById, list as listClients } from "../../db/clients";
import { getAll as getAllMeta } from "../../db/meta";
import { list as listStreams, listUserStreams, streamIdsForClient } from "../../db/streams";
import type { Deps } from "../../deps";

// Impure read-model assembly: queries the db and shapes view-ready data so the admin views stay pure.
// N+1 queries (per-build counts, per-user installed build) are fine at single-admin/alpha scale.

export interface UserView {
  id: number;
  email: string;
  status: string;
  streams: string[];
  pinnedBuildId: number | null;
  currentBuild: number | null;
  noBuild: NoBuildState;
}

export interface BuildView {
  build: Build;
  streams: string[];
  downloads: number;
  updates: number;
}

export interface StreamView {
  id: number;
  name: string;
  buildCount: number;
  userCount: number;
}

export interface Dashboard {
  users: number;
  builds: number;
  streams: number;
  noBuild: number;
  selfUpdate: { available: boolean; latest: string | null };
}

async function loadWorld(deps: Deps) {
  const clients = await listClients(deps.db);
  const builds = await listAll(deps.db);
  const buildStreams = await listBuildStreams(deps.db);
  const userStreams = await listUserStreams(deps.db);
  const streams = await listStreams(deps.db);
  const world: World = { clients, builds, buildStreams, userStreams };
  const streamName = new Map(streams.map((s) => [s.id, s.name]));
  return { world, streams, streamName };
}

export async function loadUsers(deps: Deps): Promise<UserView[]> {
  const { world, streamName } = await loadWorld(deps);
  const users: UserView[] = [];
  for (const client of world.clients) {
    const installed = await currentBuild(deps.db, client.id);
    const streamIds = world.userStreams
      .filter((link) => link.clientId === client.id)
      .map((link) => link.streamId);
    users.push({
      id: client.id,
      email: client.email,
      status: client.status,
      streams: streamIds.map((id) => streamName.get(id) ?? `#${id}`),
      pinnedBuildId: client.pinnedBuildId,
      currentBuild: installed,
      noBuild: noBuildState(world, client, installed),
    });
  }
  return users;
}

export async function loadBuilds(deps: Deps): Promise<BuildView[]> {
  const { world, streamName } = await loadWorld(deps);
  const views: BuildView[] = [];
  for (const build of world.builds) {
    const streamIds = world.buildStreams
      .filter((link) => link.buildId === build.id)
      .map((link) => link.streamId);
    views.push({
      build,
      streams: streamIds.map((id) => streamName.get(id) ?? `#${id}`),
      downloads: await countByBuild(deps.db, build.buildNumber, "download"),
      updates: await countByBuild(deps.db, build.buildNumber, "update"),
    });
  }
  return views;
}

export async function loadStreams(deps: Deps): Promise<StreamView[]> {
  const { world, streams } = await loadWorld(deps);
  return streams.map((stream) => ({
    id: stream.id,
    name: stream.name,
    buildCount: world.buildStreams.filter((link) => link.streamId === stream.id).length,
    userCount: world.userStreams.filter((link) => link.streamId === stream.id).length,
  }));
}

export async function loadDashboard(deps: Deps): Promise<Dashboard> {
  const users = await loadUsers(deps);
  const { world, streams } = await loadWorld(deps);
  const m = await getAllMeta(deps.db);
  return {
    users: world.clients.length,
    builds: world.builds.length,
    streams: streams.length,
    noBuild: users.filter((user) => user.noBuild !== "servable").length,
    selfUpdate: { available: m.selfupdate_available === "1", latest: m.selfupdate_latest ?? null },
  };
}

/** The World + per-client installed-build map that §11 validation (core/validation) operates on. */
export async function loadValidationWorld(
  deps: Deps,
): Promise<{ world: World; installed: Map<number, number> }> {
  const { world } = await loadWorld(deps);
  const installed = new Map<number, number>();
  for (const client of world.clients) {
    const build = await currentBuild(deps.db, client.id);
    if (build !== null) installed.set(client.id, build);
  }
  return { world, installed };
}

/** Users list + the channels the "Add user" form / assign controls need. */
export async function loadUsersPage(
  deps: Deps,
): Promise<{ users: UserView[]; channels: Stream[] }> {
  return { users: await loadUsers(deps), channels: await listStreams(deps.db) };
}

export interface UserDetail {
  client: Client;
  channels: Stream[];
  assignedStreamIds: number[];
  availableBuilds: Build[];
  currentBuild: number | null;
}

/** One user with everything the manage page needs (channels to assign, builds to pin). */
export async function loadUser(deps: Deps, id: number): Promise<UserDetail | null> {
  const client = await getClientById(deps.db, id);
  if (client === null) return null;
  return {
    client,
    channels: await listStreams(deps.db),
    assignedStreamIds: await streamIdsForClient(deps.db, id),
    availableBuilds: await listAvailable(deps.db),
    currentBuild: await currentBuild(deps.db, id),
  };
}

export interface BuildDetail {
  build: Build;
  channels: Stream[];
  linkedStreamIds: number[];
}

/** One build with all channels + which it's linked to (for the link/unlink controls). */
export async function loadBuildDetail(deps: Deps, id: number): Promise<BuildDetail | null> {
  const build = await getBuildById(deps.db, id);
  if (build === null) return null;
  const links = await listBuildStreams(deps.db);
  return {
    build,
    channels: await listStreams(deps.db),
    linkedStreamIds: links.filter((link) => link.buildId === id).map((link) => link.streamId),
  };
}

/** Channels for the upload form's channel select. */
export function loadChannels(deps: Deps): Promise<Stream[]> {
  return listStreams(deps.db);
}

/** Current meta values to prefill the branding/settings form. */
export function loadSettings(deps: Deps): Promise<Record<string, string>> {
  return getAllMeta(deps.db);
}

export function loadActivity(deps: Deps): Promise<AccessLogEntry[]> {
  return recent(deps.db, 100);
}

export function loadAudit(deps: Deps): Promise<AuditRow[]> {
  return listInOrder(deps.db);
}
