import { type AuditRow, assessChain, type ChainAssessment } from "../../core/audit-chain";
import { type NoBuildState, noBuildState, type World } from "../../core/no-build";
import type { Build, Client, Stream } from "../../core/types";
import {
  type ChannelServing,
  channelServings,
  offTheMap,
  type Verdict,
  verdictFor,
} from "../../core/verdict";
import {
  type AccessLogEntry,
  type ActivityFilter,
  countByBuild,
  currentBuild,
  lastActivityForBuild,
  lastEventAt,
  lastSeenAt,
  recent,
} from "../../db/access-log";
import { type AccessRequest, countPending, listByStatus } from "../../db/access-requests";
import { type AuditFilter, listForDisplay, listInOrder } from "../../db/admin-audit";
import { getById as getBuildById, listAll, listAvailable, listBuildStreams } from "../../db/builds";
import { getById as getClientById, list as listClients } from "../../db/clients";
import { getAll as getAllMeta, get as getMeta } from "../../db/meta";
import {
  getById as getStreamById,
  list as listStreams,
  listUserStreams,
  streamIdsForClient,
} from "../../db/streams";
import type { Deps } from "../../deps";

// Impure read-model assembly: queries the db and shapes view-ready data so the admin views stay pure.
// N+1 queries (per-build counts, per-user installed build) are fine at single-admin/alpha scale.

export interface UserView {
  id: number;
  email: string;
  label: string | null;
  status: string;
  streams: string[];
  pinnedBuildId: number | null;
  /** The pinned build resolved for display (never show a raw row id). */
  pinnedBuild: Build | null;
  currentBuild: number | null;
  lastInstalled: string | null;
  lastUpdated: string | null;
  /** Most recent event of any kind — the "last seen" column. */
  lastSeen: string | null;
  /** What this user's next update check actually does, by cause (core/verdict). */
  verdict: Verdict;
  noBuild: NoBuildState;
  hidden: boolean;
}

export interface BuildView {
  build: Build;
  streams: string[];
  downloads: number;
  updates: number;
  lastActivity: string | null;
}

export interface StreamView {
  id: number;
  name: string;
  buildCount: number;
  userCount: number;
}

export interface SelfUpdateView {
  available: boolean;
  latest: string | null;
  breaking: boolean;
  belowMinSupported: boolean;
  notesUrl: string | null;
}

/** A user whose next check is faulted — the dashboard's attention material, with its cause. */
export interface FaultedUser {
  id: number;
  email: string;
  verdict: Verdict;
  /** Channel names the user is assigned to (for remedy links). */
  streams: string[];
}

/** One line of the merged recent feed (tester activity + admin actions), newest first. */
export interface RecentItem {
  at: string;
  /** Pre-composed operator sentence fragments; the view renders links from the refs. */
  kind: "check" | "download" | "update" | "admin";
  email: string | null;
  clientId: number | null;
  buildNumber: number | null;
  /** For admin rows: the audit action slug (e.g. "build.withdraw") and its target. */
  action: string | null;
  target: string | null;
}

export interface Dashboard {
  users: number;
  hiddenUsers: number;
  builds: number;
  hiddenBuilds: number;
  streams: number;
  noBuild: number;
  pendingRequests: number;
  /** Oldest pending request time + a couple of addresses for the attention row. */
  pendingSample: { emails: string[]; oldest: string | null };
  selfUpdate: SelfUpdateView;
  /** The serving map rows (per channel), computed from the same World the resolver uses. */
  servings: ChannelServing[];
  /** Active users routed nowhere (no channel, no pin) — the map's "off the map" row. */
  offMap: { id: number; email: string }[];
  /** Visible (non-hidden) active users whose next check is faulted, with causes. */
  faults: FaultedUser[];
  /** Merged recent feed: tester activity + admin audit rows, newest first. */
  recent: RecentItem[];
  /** The newest build and where it went — the header's "last publish" line. */
  lastPublish: { build: Build; streams: string[] } | null;
  /** Audit-chain integrity (same judgment as the daily anchor). Null when no audit rows exist. */
  chain: ChainAssessment | null;
}

/** Reads the §22 self-update status the daily cron persisted into `meta`. */
export function selfUpdateView(m: Record<string, string>): SelfUpdateView {
  return {
    available: m.selfupdate_available === "1",
    latest: m.selfupdate_latest || null,
    breaking: m.selfupdate_breaking === "1",
    belowMinSupported: m.selfupdate_below_min === "1",
    notesUrl: m.selfupdate_notes_url || null,
  };
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
      label: client.label,
      status: client.status,
      streams: streamIds.map((id) => streamName.get(id) ?? `#${id}`),
      pinnedBuildId: client.pinnedBuildId,
      pinnedBuild:
        client.pinnedBuildId === null
          ? null
          : (world.builds.find((b) => b.id === client.pinnedBuildId) ?? null),
      currentBuild: installed,
      lastInstalled: await lastEventAt(deps.db, client.id, "download"),
      lastUpdated: await lastEventAt(deps.db, client.id, "update"),
      lastSeen: await lastSeenAt(deps.db, client.id),
      verdict: verdictFor(world, client, installed),
      noBuild: noBuildState(world, client, installed),
      hidden: client.hidden,
    });
  }
  return users;
}

export async function loadBuilds(deps: Deps): Promise<BuildView[]> {
  const { world, streamName } = await loadWorld(deps);
  const views: BuildView[] = [];
  // Newest first — the monotonic build_number is the release order, and the newest release is what
  // the operator came to check.
  const ordered = [...world.builds].sort((a, b) => b.buildNumber - a.buildNumber);
  for (const build of ordered) {
    const streamIds = world.buildStreams
      .filter((link) => link.buildId === build.id)
      .map((link) => link.streamId);
    views.push({
      build,
      streams: streamIds.map((id) => streamName.get(id) ?? `#${id}`),
      downloads: await countByBuild(deps.db, build.buildNumber, "download"),
      updates: await countByBuild(deps.db, build.buildNumber, "update"),
      lastActivity: await lastActivityForBuild(deps.db, build.buildNumber),
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
  const { world, streams, streamName } = await loadWorld(deps);
  const m = await getAllMeta(deps.db);

  const installed = new Map<number, number>();
  for (const client of world.clients) {
    const current = await currentBuild(deps.db, client.id);
    if (current !== null) installed.set(client.id, current);
  }

  // Faulted users: visible + active only — hiding a user is the operator saying "stop counting them".
  const faults: FaultedUser[] = [];
  for (const client of world.clients) {
    if (client.hidden || client.status !== "active") continue;
    const verdict = verdictFor(world, client, installed.get(client.id) ?? null);
    if (verdict.kind === "offered" || verdict.kind === "up-to-date") continue;
    const streamIds = world.userStreams
      .filter((link) => link.clientId === client.id)
      .map((link) => link.streamId);
    faults.push({
      id: client.id,
      email: client.email,
      verdict,
      streams: streamIds.map((id) => streamName.get(id) ?? `#${id}`),
    });
  }

  // Merged recent feed: tester activity + admin audit rows, by time, newest first.
  const emailToId = new Map(world.clients.map((c) => [c.email, c.id]));
  const activity = await recent(deps.db, { limit: 8 });
  const audit = await listForDisplay(deps.db, {});
  const recentItems: RecentItem[] = [
    ...activity.map(
      (e): RecentItem => ({
        at: e.createdAt,
        kind: e.event,
        email: e.email,
        clientId: e.email === null ? null : (emailToId.get(e.email) ?? null),
        buildNumber: e.buildNumber,
        action: null,
        target: null,
      }),
    ),
    ...audit.slice(0, 8).map(
      (r): RecentItem => ({
        at: r.createdAt,
        kind: "admin",
        email: null,
        clientId: r.target === null ? (null as number | null) : (emailToId.get(r.target) ?? null),
        buildNumber: null,
        action: r.action,
        target: r.target,
      }),
    ),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 8);

  const newest = world.builds.reduce<Build | null>(
    (top, b) => (top === null || b.buildNumber > top.buildNumber ? b : top),
    null,
  );
  const lastPublish =
    newest === null
      ? null
      : {
          build: newest,
          streams: world.buildStreams
            .filter((l) => l.buildId === newest.id)
            .map((l) => streamName.get(l.streamId) ?? `#${l.streamId}`),
        };

  const pending = await listByStatus(deps.db, "pending");
  const auditRows = await listInOrder(deps.db);
  const chain =
    auditRows.length === 0
      ? null
      : await assessChain(auditRows, await getMeta(deps.db, "audit_anchor_head"));

  return {
    users: world.clients.filter((c) => !c.hidden).length,
    hiddenUsers: world.clients.filter((c) => c.hidden).length,
    builds: world.builds.filter((b) => !b.hidden).length,
    hiddenBuilds: world.builds.filter((b) => b.hidden).length,
    streams: streams.length,
    noBuild: faults.length,
    pendingRequests: pending.length,
    pendingSample: {
      emails: pending.slice(0, 2).map((r) => r.email),
      oldest: pending.at(-1)?.createdAt ?? null,
    },
    selfUpdate: selfUpdateView(m),
    servings: channelServings(world, streams, installed),
    offMap: offTheMap(world).map((c) => ({ id: c.id, email: c.email })),
    faults,
    recent: recentItems,
    lastPublish,
    chain,
  };
}

export function loadPending(deps: Deps): Promise<AccessRequest[]> {
  return listByStatus(deps.db, "pending");
}

/** Pending-request count for the nav chip every admin page shows. */
export function loadPendingCount(deps: Deps): Promise<number> {
  return countPending(deps.db);
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
  /** What this user's next check does, by cause — the detail page's verdict strip. */
  verdict: Verdict;
  pinnedBuild: Build | null;
  lastCheck: string | null;
  lastInstalled: string | null;
  lastUpdated: string | null;
}

/** One user with everything the manage page needs (channels to assign, builds to pin). */
export async function loadUser(deps: Deps, id: number): Promise<UserDetail | null> {
  const client = await getClientById(deps.db, id);
  if (client === null) return null;
  const { world } = await loadWorld(deps);
  const installed = await currentBuild(deps.db, id);
  return {
    client,
    channels: await listStreams(deps.db),
    assignedStreamIds: await streamIdsForClient(deps.db, id),
    availableBuilds: await listAvailable(deps.db),
    currentBuild: installed,
    verdict: verdictFor(world, client, installed),
    pinnedBuild:
      client.pinnedBuildId === null
        ? null
        : (world.builds.find((b) => b.id === client.pinnedBuildId) ?? null),
    lastCheck: await lastEventAt(deps.db, id, "check"),
    lastInstalled: await lastEventAt(deps.db, id, "download"),
    lastUpdated: await lastEventAt(deps.db, id, "update"),
  };
}

export interface BuildDetail {
  build: Build;
  channels: Stream[];
  linkedStreamIds: number[];
  downloads: number;
  updates: number;
  lastActivity: string | null;
  /** How many active users this build is the resolver's answer for right now. */
  audience: { offeredTo: number; currentFor: number };
}

/** One build with all channels + which it's linked to (for the link/unlink controls). */
export async function loadBuildDetail(deps: Deps, id: number): Promise<BuildDetail | null> {
  const build = await getBuildById(deps.db, id);
  if (build === null) return null;
  const { world } = await loadWorld(deps);
  const links = world.buildStreams;

  let offeredTo = 0;
  let currentFor = 0;
  for (const client of world.clients) {
    if (client.status !== "active") continue;
    const installed = await currentBuild(deps.db, client.id);
    const verdict = verdictFor(world, client, installed);
    if (verdict.kind === "offered" && verdict.build.id === id) offeredTo++;
    if (verdict.kind === "up-to-date" && verdict.build.id === id) currentFor++;
  }

  return {
    build,
    channels: await listStreams(deps.db),
    linkedStreamIds: links.filter((link) => link.buildId === id).map((link) => link.streamId),
    downloads: await countByBuild(deps.db, build.buildNumber, "download"),
    updates: await countByBuild(deps.db, build.buildNumber, "update"),
    lastActivity: await lastActivityForBuild(deps.db, build.buildNumber),
    audience: { offeredTo, currentFor },
  };
}

export interface StreamDetail {
  stream: Stream;
  /** Builds linked to this channel (any status), newest first. */
  linkedBuilds: Build[];
  /** Available builds not yet linked — the link control's options. */
  unlinkedBuilds: Build[];
  /** Highest-numbered available linked build — what this channel currently serves (§8). */
  topBuild: Build | null;
  /** Clients assigned to this channel, each with their next-check verdict. */
  assignedUsers: (Client & { verdict: Verdict })[];
  /** Active clients not assigned — the assign control's options. */
  unassignedUsers: Client[];
  /** The channel's audience math (same row the dashboard map shows). */
  serving: ChannelServing;
}

/** One channel with the builds it carries and the users it serves (the §13 channel manage page). */
export async function loadStreamDetail(deps: Deps, id: number): Promise<StreamDetail | null> {
  const stream = await getStreamById(deps.db, id);
  if (stream === null) return null;
  const { world } = await loadWorld(deps);

  const linkedBuildIds = new Set(
    world.buildStreams.filter((link) => link.streamId === id).map((link) => link.buildId),
  );
  const linkedBuilds = world.builds
    .filter((build) => linkedBuildIds.has(build.id))
    .sort((a, b) => b.buildNumber - a.buildNumber);
  const unlinkedBuilds = world.builds
    .filter((build) => !linkedBuildIds.has(build.id) && build.status === "available")
    .sort((a, b) => b.buildNumber - a.buildNumber);
  const topBuild = linkedBuilds
    .filter((build) => build.status === "available")
    .reduce<Build | null>(
      (top, build) => (top === null || build.buildNumber > top.buildNumber ? build : top),
      null,
    );

  const installed = new Map<number, number>();
  for (const client of world.clients) {
    const current = await currentBuild(deps.db, client.id);
    if (current !== null) installed.set(client.id, current);
  }

  const assignedClientIds = new Set(
    world.userStreams.filter((link) => link.streamId === id).map((link) => link.clientId),
  );
  const assignedUsers = world.clients
    .filter((client) => assignedClientIds.has(client.id))
    .map((client) => ({
      ...client,
      verdict: verdictFor(world, client, installed.get(client.id) ?? null),
    }));
  const unassignedUsers = world.clients.filter(
    (client) => !assignedClientIds.has(client.id) && client.status === "active",
  );

  const [serving] = channelServings(world, [stream], installed);
  return {
    stream,
    linkedBuilds,
    unlinkedBuilds,
    topBuild,
    assignedUsers,
    unassignedUsers,
    serving: serving ?? {
      streamId: id,
      name: stream.name,
      top: null,
      users: 0,
      willUpdate: 0,
      upToDate: 0,
      faulted: 0,
      pinned: 0,
    },
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

export function loadActivity(deps: Deps, filter: ActivityFilter = {}): Promise<AccessLogEntry[]> {
  return recent(deps.db, { limit: 100, ...filter });
}

export function loadAudit(deps: Deps, filter: AuditFilter = {}): Promise<AuditRow[]> {
  return listForDisplay(deps.db, filter);
}

/**
 * Live audit-chain integrity for the Audit page — the same judgment the daily anchor records
 * (core/audit-chain assessChain), so the page and the cron can never disagree. Null when the log
 * is still empty.
 */
export async function loadChainStatus(deps: Deps): Promise<ChainAssessment | null> {
  const rows = await listInOrder(deps.db);
  if (rows.length === 0) return null;
  return assessChain(rows, await getMeta(deps.db, "audit_anchor_head"));
}
