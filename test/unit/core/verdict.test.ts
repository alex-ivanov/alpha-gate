import { describe, expect, it } from "vitest";
import type { World } from "../../../src/core/no-build";
import type { Build, Client } from "../../../src/core/types";
import {
  channelServings,
  formatBytes,
  formatWhen,
  isFault,
  offTheMap,
  verdictFor,
} from "../../../src/core/verdict";

// The display verdict — "what does this user's next check actually do, and why" — must agree with
// the runtime resolver on every branch, because the back office renders it as the truth.

let nextId = 1;
function build(over: Partial<Build> = {}): Build {
  return {
    id: nextId++,
    shortVersion: "1.0.0",
    buildNumber: 1000,
    objectKey: "build/x",
    edSignature: "sig",
    length: 1,
    minOs: null,
    critical: false,
    rollbackTarget: false,
    status: "available",
    hidden: false,
    dmgObjectKey: null,
    dmgLength: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function client(over: Partial<Client> = {}): Client {
  return {
    id: nextId++,
    email: "u@example.test",
    token: "T".repeat(32),
    status: "active",
    pinnedBuildId: null,
    label: null,
    hidden: false,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

/** One channel (id 1) carrying `builds`, with `c` assigned to it. */
function worldWith(c: Client, builds: Build[], assigned = true): World {
  return {
    clients: [c],
    builds,
    buildStreams: builds.map((b) => ({ buildId: b.id, streamId: 1 })),
    userStreams: assigned ? [{ clientId: c.id, streamId: 1 }] : [],
  };
}

describe("verdictFor", () => {
  it("offers the channel head to a user below it", () => {
    const c = client();
    const top = build({ buildNumber: 1500 });
    const v = verdictFor(worldWith(c, [build({ buildNumber: 1400 }), top]), c, 1400);
    expect(v).toEqual({ kind: "offered", build: top, via: "channel" });
    expect(isFault(v)).toBe(false);
  });

  it("reports up-to-date at the channel head", () => {
    const c = client();
    const top = build({ buildNumber: 1500 });
    const v = verdictFor(worldWith(c, [top]), c, 1500);
    expect(v).toEqual({ kind: "up-to-date", build: top, via: "channel" });
  });

  it("offers the head to a user who has never installed anything", () => {
    const c = client();
    const top = build({ buildNumber: 1500 });
    expect(verdictFor(worldWith(c, [top]), c, null)).toEqual({
      kind: "offered",
      build: top,
      via: "channel",
    });
  });

  it("classifies revoked before anything else", () => {
    const c = client({ status: "revoked" });
    expect(verdictFor(worldWith(c, [build()]), c, null)).toEqual({ kind: "revoked" });
  });

  it("classifies no-channel for an unassigned, unpinned user", () => {
    const c = client();
    const v = verdictFor(worldWith(c, [build()], false), c, null);
    expect(v).toEqual({ kind: "no-channel" });
    expect(isFault(v)).toBe(true);
  });

  it("classifies empty-channel when the channels carry no available build", () => {
    const c = client();
    const v = verdictFor(worldWith(c, [build({ status: "withdrawn" })]), c, null);
    expect(v).toEqual({ kind: "empty-channel" });
  });

  it("classifies stranded when installed is above everything the channels offer (no-downgrade)", () => {
    const c = client();
    const top = build({ buildNumber: 1300 });
    const v = verdictFor(
      worldWith(c, [top, build({ buildNumber: 1400, status: "withdrawn" })]),
      c,
      1400,
    );
    expect(v).toEqual({ kind: "stranded", installed: 1400, top });
  });

  it("a pin at the installed build is up-to-date via the pin", () => {
    const pinned = build({ buildNumber: 1200 });
    const c = client({ pinnedBuildId: pinned.id });
    expect(verdictFor(worldWith(c, [pinned, build({ buildNumber: 1500 })]), c, 1200)).toEqual({
      kind: "up-to-date",
      build: pinned,
      via: "pin",
    });
  });

  it("a pin above the installed build is offered via the pin", () => {
    const pinned = build({ buildNumber: 1400 });
    const c = client({ pinnedBuildId: pinned.id });
    expect(verdictFor(worldWith(c, [pinned]), c, 1200)).toEqual({
      kind: "offered",
      build: pinned,
      via: "pin",
    });
  });

  it("a pin below the installed build serves nothing (Sparkle can't downgrade)", () => {
    const pinned = build({ buildNumber: 1100 });
    const c = client({ pinnedBuildId: pinned.id });
    const v = verdictFor(worldWith(c, [pinned]), c, 1200);
    expect(v).toEqual({ kind: "pin-below-installed", pinned, installed: 1200 });
    expect(isFault(v)).toBe(true);
  });

  it("a pin to a withdrawn build serves nothing — and never falls back to channels", () => {
    const pinned = build({ buildNumber: 1100, status: "withdrawn" });
    const c = client({ pinnedBuildId: pinned.id });
    const v = verdictFor(worldWith(c, [pinned, build({ buildNumber: 1500 })]), c, null);
    expect(v).toEqual({ kind: "pin-unavailable", pinnedBuildId: pinned.id });
  });
});

describe("channelServings", () => {
  it("sums the audience math per channel from individual verdicts", () => {
    const top = build({ buildNumber: 1500 });
    const older = build({ buildNumber: 1200 });
    const behind = client({ id: 900, email: "behind@x" });
    const current = client({ id: 901, email: "current@x" });
    const pinnedUser = client({ id: 902, email: "pin@x", pinnedBuildId: older.id });
    const revoked = client({ id: 903, email: "gone@x", status: "revoked" });
    const world: World = {
      clients: [behind, current, pinnedUser, revoked],
      builds: [top, older],
      buildStreams: [
        { buildId: top.id, streamId: 7 },
        { buildId: older.id, streamId: 7 },
      ],
      userStreams: [900, 901, 902, 903].map((clientId) => ({ clientId, streamId: 7 })),
    };
    const installed = new Map([
      [900, 1200],
      [901, 1500],
      [902, 1200],
    ]);

    const [row] = channelServings(world, [{ id: 7, name: "stable" }], installed);
    expect(row?.top).toEqual(top);
    expect(row?.users).toBe(3); // revoked users are not audience
    expect(row?.willUpdate).toBe(1); // behind
    expect(row?.upToDate).toBe(2); // current + pin held at 1200
    expect(row?.faulted).toBe(0);
    expect(row?.pinned).toBe(1);
  });

  it("reports a channel with no available build as serving nothing", () => {
    const world: World = { clients: [], builds: [], buildStreams: [], userStreams: [] };
    const [row] = channelServings(world, [{ id: 1, name: "nightly" }], new Map());
    expect(row?.top).toBeNull();
    expect(row?.users).toBe(0);
  });
});

describe("offTheMap", () => {
  it("finds active users with no channel and no pin — and only those", () => {
    const lost = client({ id: 1, email: "lost@x" });
    const assigned = client({ id: 2, email: "ok@x" });
    const pinned = client({ id: 3, email: "pin@x", pinnedBuildId: 99 });
    const revoked = client({ id: 4, email: "gone@x", status: "revoked" });
    const world: World = {
      clients: [lost, assigned, pinned, revoked],
      builds: [],
      buildStreams: [],
      userStreams: [{ clientId: 2, streamId: 1 }],
    };
    expect(offTheMap(world).map((c) => c.email)).toEqual(["lost@x"]);
  });
});

describe("formatWhen", () => {
  it("renders month day hh:mm, dropping the year when current", () => {
    expect(formatWhen("2026-07-09T08:30:12.345Z", "2026-07-11T00:00:00Z")).toBe("Jul 09 08:30");
  });
  it("keeps the year when it differs", () => {
    expect(formatWhen("2025-12-31T23:59:00Z", "2026-07-11T00:00:00Z")).toBe("Dec 31 23:59 2025");
  });
  it("passes through non-ISO input unchanged", () => {
    expect(formatWhen("—", "2026-07-11T00:00:00Z")).toBe("—");
  });
});

describe("formatBytes", () => {
  it("humanizes with one decimal under 100, none above", () => {
    expect(formatBytes(22)).toBe("22 B");
    expect(formatBytes(88_301_231)).toBe("84.2 MB");
    expect(formatBytes(215_000_000)).toBe("205 MB");
  });
});
