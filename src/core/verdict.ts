import type { World } from "./no-build";
import type { Build, Client } from "./types";

// The display-grade answer to "what does this user's NEXT update check actually do?" — the §8
// resolver's outcome refined with the user's last-reported installed build and the no-downgrade rule,
// classified by CAUSE so every page can say not just "no build" but why, and what fixes it. Pure over
// plain data (§23): the same World the runtime resolver uses, no bindings, no clock.

export type Verdict =
  /** The next check offers this build (installed is below it, or nothing installed yet). */
  | { kind: "offered"; build: Build; via: "pin" | "channel" }
  /** The resolver targets exactly what is installed — Sparkle reports "up to date". */
  | { kind: "up-to-date"; build: Build; via: "pin" | "channel" }
  /** Revoked: every check returns the reactivation notice, never a build. */
  | { kind: "revoked" }
  /** Active but assigned to no channel (and unpinned) — resolves to nothing, always. */
  | { kind: "no-channel" }
  /** Channels are assigned but none carries an available build. */
  | { kind: "empty-channel" }
  /** Pinned to a build that is withdrawn or gone — the pin serves nothing. */
  | { kind: "pin-unavailable"; pinnedBuildId: number }
  /** Pinned below the installed build — Sparkle won't downgrade, so the pin serves nothing. */
  | { kind: "pin-below-installed"; pinned: Build; installed: number }
  /** Installed sits above everything the channels offer — stranded under no-downgrade (§11). */
  | { kind: "stranded"; installed: number; top: Build };

/** True when the verdict means the user's feed is empty/faulted (the amber states). */
export function isFault(verdict: Verdict): boolean {
  return verdict.kind !== "offered" && verdict.kind !== "up-to-date" && verdict.kind !== "revoked";
}

export function verdictFor(
  world: World,
  client: Client,
  installedBuildNumber: number | null,
): Verdict {
  if (client.status === "revoked") return { kind: "revoked" };

  // A pin overrides channel resolution entirely (§8.2) — and never falls back.
  if (client.pinnedBuildId !== null) {
    const pinned = world.builds.find((build) => build.id === client.pinnedBuildId);
    if (pinned === undefined || pinned.status !== "available") {
      return { kind: "pin-unavailable", pinnedBuildId: client.pinnedBuildId };
    }
    if (installedBuildNumber !== null && pinned.buildNumber < installedBuildNumber) {
      return { kind: "pin-below-installed", pinned, installed: installedBuildNumber };
    }
    if (installedBuildNumber !== null && pinned.buildNumber === installedBuildNumber) {
      return { kind: "up-to-date", build: pinned, via: "pin" };
    }
    return { kind: "offered", build: pinned, via: "pin" };
  }

  const streamIds = new Set(
    world.userStreams.filter((link) => link.clientId === client.id).map((link) => link.streamId),
  );
  if (streamIds.size === 0) return { kind: "no-channel" };

  const buildIds = new Set(
    world.buildStreams.filter((link) => streamIds.has(link.streamId)).map((link) => link.buildId),
  );
  let top: Build | null = null;
  for (const build of world.builds) {
    if (build.status !== "available" || !buildIds.has(build.id)) continue;
    if (top === null || build.buildNumber > top.buildNumber) top = build;
  }
  if (top === null) return { kind: "empty-channel" };

  if (installedBuildNumber === null || top.buildNumber > installedBuildNumber) {
    return { kind: "offered", build: top, via: "channel" };
  }
  if (top.buildNumber === installedBuildNumber) {
    return { kind: "up-to-date", build: top, via: "channel" };
  }
  return { kind: "stranded", installed: installedBuildNumber, top };
}

/** One serving-map row: what a channel offers and how its audience actually fares. */
export interface ChannelServing {
  streamId: number;
  name: string;
  /** Highest available linked build — what the channel offers (§8) — or null (serving nothing). */
  top: Build | null;
  /** Active users assigned to the channel (revoked users are not counted as audience). */
  users: number;
  /** Users whose next check will move them (verdict: offered). */
  willUpdate: number;
  /** Users already at the channel's head (or held at an equal pin). */
  upToDate: number;
  /** Users whose feed is empty while assigned here — stranded, pin faults (the amber count). */
  faulted: number;
  /** Users held elsewhere by a pin (their pin overrides this channel). */
  pinned: number;
}

/**
 * The dashboard serving map, computed from the same World as runtime resolution — one row per
 * channel plus the audience math per user verdict. `installed` maps client id → last-reported build.
 */
export function channelServings(
  world: World,
  streams: readonly { id: number; name: string }[],
  installed: ReadonlyMap<number, number>,
): ChannelServing[] {
  return streams.map((stream) => {
    const buildIds = new Set(
      world.buildStreams.filter((l) => l.streamId === stream.id).map((l) => l.buildId),
    );
    let top: Build | null = null;
    for (const build of world.builds) {
      if (build.status !== "available" || !buildIds.has(build.id)) continue;
      if (top === null || build.buildNumber > top.buildNumber) top = build;
    }

    const memberIds = new Set(
      world.userStreams.filter((l) => l.streamId === stream.id).map((l) => l.clientId),
    );
    let users = 0;
    let willUpdate = 0;
    let upToDate = 0;
    let faulted = 0;
    let pinned = 0;
    for (const client of world.clients) {
      if (!memberIds.has(client.id) || client.status !== "active") continue;
      users++;
      const verdict = verdictFor(world, client, installed.get(client.id) ?? null);
      if (client.pinnedBuildId !== null) pinned++;
      if (verdict.kind === "offered") willUpdate++;
      else if (verdict.kind === "up-to-date") upToDate++;
      else faulted++;
    }
    return {
      streamId: stream.id,
      name: stream.name,
      top,
      users,
      willUpdate,
      upToDate,
      faulted,
      pinned,
    };
  });
}

/** Active users assigned to NO channel and not pinned — routed nowhere; the map's "off the map" row. */
export function offTheMap(world: World): Client[] {
  const assigned = new Set(world.userStreams.map((link) => link.clientId));
  return world.clients.filter(
    (client) =>
      client.status === "active" && !assigned.has(client.id) && client.pinnedBuildId === null,
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "Jul 09 08:30" from an ISO-8601 string — the UI's one timestamp form (full ISO stays in the
 * element's title). Pure string slicing, no Date (lib/clock owns time). Adds the year only when it
 * differs from `nowIso`'s. Returns the input unchanged when it doesn't look like an ISO timestamp.
 */
export function formatWhen(iso: string, nowIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (m === null) return iso;
  const [, year, month, day, hh, mm] = m;
  const monthName = MONTHS[Number(month) - 1] ?? month;
  const sameYear = nowIso.startsWith(`${year}-`);
  return `${monthName} ${day} ${hh}:${mm}${sameYear ? "" : ` ${year}`}`;
}

/** "84.2 MB" from bytes — exact count belongs in the title attribute. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${unit}`;
}
