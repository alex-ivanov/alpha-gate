import { describe, expect, it } from "vitest";
import {
  type AdminAction,
  computeAffectedUsers,
  isServableResult,
  noBuildState,
  resolveForClient,
} from "../../../src/core/no-build";
import { aBuild, aClient, aWorld } from "../../support/factories";

// §11 — servability and the no-build state. Shares the resolver so the confirmation preview and
// runtime resolution can never disagree. `noBuildState` is installed-build-aware (no-downgrade):
// a user stuck on a withdrawn build with no HIGHER available build is "stranded", distinct from a
// plain "empty" (no available build at all). The §11 confirmation lists who would become no-build.

const STABLE = 1;
const BETA = 2;

describe("isServableResult", () => {
  it.each([
    { kind: "target", servable: true },
    { kind: "informational", servable: false },
    { kind: "none", servable: false },
  ])("$kind → servable=$servable", ({ kind, servable }) => {
    const result =
      kind === "target"
        ? ({ kind: "target", build: aBuild() } as const)
        : kind === "informational"
          ? ({ kind: "informational", reason: "revoked" } as const)
          : ({ kind: "none" } as const);
    expect(isServableResult(result)).toBe(servable);
  });
});

describe("noBuildState", () => {
  it("servable — an available build in the client's stream, newer than installed", () => {
    const client = aClient({ id: 1 });
    const world = aWorld({
      clients: [client],
      builds: [aBuild({ id: 1500, buildNumber: 1500 })],
      buildStreams: [{ buildId: 1500, streamId: STABLE }],
      userStreams: [{ clientId: 1, streamId: STABLE }],
    });
    expect(noBuildState(world, client, 1400)).toBe("servable");
  });

  it("empty — no streams and no builds at all (e.g. a brand-new client)", () => {
    const client = aClient({ id: 1 });
    const world = aWorld({ clients: [client] });
    expect(noBuildState(world, client, null)).toBe("empty");
  });

  it("stranded — on a withdrawn build with no higher available in the stream", () => {
    const client = aClient({ id: 1 });
    const world = aWorld({
      clients: [client],
      builds: [aBuild({ id: 1500, buildNumber: 1500, status: "withdrawn" })],
      buildStreams: [{ buildId: 1500, streamId: STABLE }],
      userStreams: [{ clientId: 1, streamId: STABLE }],
    });
    expect(noBuildState(world, client, 1500)).toBe("stranded");
  });

  it("servable — on a withdrawn build BUT a higher available build exists (roll-forward, §9)", () => {
    const client = aClient({ id: 1 });
    const world = aWorld({
      clients: [client],
      builds: [
        aBuild({ id: 1500, buildNumber: 1500, status: "withdrawn" }),
        aBuild({ id: 1600, buildNumber: 1600, status: "available" }),
      ],
      buildStreams: [
        { buildId: 1500, streamId: STABLE },
        { buildId: 1600, streamId: STABLE },
      ],
      userStreams: [{ clientId: 1, streamId: STABLE }],
    });
    expect(noBuildState(world, client, 1500)).toBe("servable");
  });

  it("empty — pinned to a withdrawn build (§11 first bullet), installed unknown", () => {
    const client = aClient({ id: 1, pinnedBuildId: 1500 });
    const world = aWorld({
      clients: [client],
      builds: [aBuild({ id: 1500, buildNumber: 1500, status: "withdrawn" })],
      buildStreams: [{ buildId: 1500, streamId: STABLE }],
      userStreams: [{ clientId: 1, streamId: STABLE }],
    });
    expect(noBuildState(world, client, null)).toBe("empty");
  });

  it("empty — pinned to a withdrawn build stays empty even when installed on that same build (§11)", () => {
    // §11 files "pinned to a now-withdrawn build" under the EMPTY bullet — the pin is the cause, so
    // the label must not flip to "stranded" just because the installed build happens to be withdrawn.
    const client = aClient({ id: 1, pinnedBuildId: 1500 });
    const world = aWorld({
      clients: [client],
      builds: [aBuild({ id: 1500, buildNumber: 1500, status: "withdrawn" })],
      buildStreams: [{ buildId: 1500, streamId: STABLE }],
      userStreams: [{ clientId: 1, streamId: STABLE }],
    });
    expect(noBuildState(world, client, 1500)).toBe("empty");
  });

  it("empty — pinned to a withdrawn build even when a higher available build exists in the stream", () => {
    // The pin overrides stream resolution, so the higher stream build is irrelevant: still "empty",
    // never "stranded" (whose defining condition is the no-downgrade stream dead-end).
    const client = aClient({ id: 1, pinnedBuildId: 1500 });
    const world = aWorld({
      clients: [client],
      builds: [
        aBuild({ id: 1500, buildNumber: 1500, status: "withdrawn" }),
        aBuild({ id: 1600, buildNumber: 1600, status: "available" }),
      ],
      buildStreams: [
        { buildId: 1500, streamId: STABLE },
        { buildId: 1600, streamId: STABLE },
      ],
      userStreams: [{ clientId: 1, streamId: STABLE }],
    });
    expect(noBuildState(world, client, 1500)).toBe("empty");
  });
});

describe("computeAffectedUsers (§11 confirmation preview)", () => {
  // A world: two clients in `stable`, both currently servable by build #1500.
  function baseWorld() {
    return aWorld({
      clients: [
        aClient({ id: 1, email: "a@example.test" }),
        aClient({ id: 2, email: "b@example.test" }),
      ],
      builds: [aBuild({ id: 1500, buildNumber: 1500 })],
      buildStreams: [{ buildId: 1500, streamId: STABLE }],
      userStreams: [
        { clientId: 1, streamId: STABLE },
        { clientId: 2, streamId: STABLE },
      ],
    });
  }
  const installed = new Map([
    [1, 1400],
    [2, 1400],
  ]);

  it("withdrawing the only available build strands everyone on it", () => {
    const action: AdminAction = { type: "withdraw-build", buildId: 1500 };
    expect(computeAffectedUsers(baseWorld(), action, installed).sort()).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
  });

  it("withdrawing a build is harmless when a higher available build remains", () => {
    const world = aWorld({
      ...baseWorld(),
      builds: [aBuild({ id: 1500, buildNumber: 1500 }), aBuild({ id: 1600, buildNumber: 1600 })],
      buildStreams: [
        { buildId: 1500, streamId: STABLE },
        { buildId: 1600, streamId: STABLE },
      ],
    });
    const action: AdminAction = { type: "withdraw-build", buildId: 1500 };
    expect(computeAffectedUsers(world, action, installed)).toEqual([]);
  });

  it("unassigning a user from their only stream affects just that user", () => {
    const action: AdminAction = { type: "unassign-user-stream", clientId: 1, streamId: STABLE };
    expect(computeAffectedUsers(baseWorld(), action, installed)).toEqual(["a@example.test"]);
  });

  it("removing the build from the stream affects everyone served by it", () => {
    const action: AdminAction = {
      type: "remove-build-from-stream",
      buildId: 1500,
      streamId: STABLE,
    };
    expect(computeAffectedUsers(baseWorld(), action, installed).sort()).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
  });

  it("pinning a user to a withdrawn build strands that user", () => {
    const world = aWorld({
      ...baseWorld(),
      builds: [
        aBuild({ id: 1500, buildNumber: 1500 }),
        aBuild({ id: 1400, buildNumber: 1400, status: "withdrawn" }),
      ],
      buildStreams: [{ buildId: 1500, streamId: STABLE }],
    });
    const action: AdminAction = { type: "pin-client", clientId: 1, buildId: 1400 };
    expect(computeAffectedUsers(world, action, installed)).toEqual(["a@example.test"]);
  });

  it("restoring a build never strands anyone", () => {
    const world = aWorld({
      ...baseWorld(),
      builds: [aBuild({ id: 1500, buildNumber: 1500, status: "withdrawn" })],
    });
    const action: AdminAction = { type: "restore-build", buildId: 1500 };
    expect(computeAffectedUsers(world, action, installed)).toEqual([]);
  });

  it("deleting a channel strands the users whose only build was served by it", () => {
    const action: AdminAction = { type: "delete-stream", streamId: STABLE };
    expect(computeAffectedUsers(baseWorld(), action, installed).sort()).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
  });
});

describe("resolveForClient", () => {
  it("derives the client's stream ids from user_streams and delegates to resolve", () => {
    const client = aClient({ id: 1 });
    const world = aWorld({
      clients: [client],
      builds: [aBuild({ id: 1600, buildNumber: 1600 })],
      buildStreams: [{ buildId: 1600, streamId: BETA }],
      userStreams: [{ clientId: 1, streamId: BETA }],
    });
    const result = resolveForClient(world, client);
    expect(result.kind === "target" && result.build.buildNumber).toBe(1600);
  });
});
