import { describe, expect, it } from "vitest";
import type { AdminAction } from "../../../src/core/no-build";
import { validateAction, validateActions } from "../../../src/core/validation";
import { aBuild, aClient, aWorld } from "../../support/factories";

// §11 — pre-mutation validation. Actions that would strand users are NOT blocked; they need explicit
// confirmation. validateAction returns the affected set (from the SAME pure core as runtime
// resolution) and whether confirmation is required, plus defensive guards on malformed params.

const STABLE = 1;

function baseWorld() {
  return aWorld({
    clients: [aClient({ id: 1, email: "a@example.test" })],
    builds: [aBuild({ id: 1500, buildNumber: 1500 })],
    buildStreams: [{ buildId: 1500, streamId: STABLE }],
    userStreams: [{ clientId: 1, streamId: STABLE }],
  });
}
const installed = new Map([[1, 1400]]);

describe("validateAction", () => {
  it("requires confirmation and lists the affected users for a stranding action", () => {
    const action: AdminAction = { type: "withdraw-build", buildId: 1500 };
    const result = validateAction(baseWorld(), action, installed);

    expect(result).toEqual({
      ok: true,
      needsConfirm: true,
      affectedEmails: ["a@example.test"],
    });
  });

  it("allows a harmless action without confirmation", () => {
    const world = aWorld({
      ...baseWorld(),
      builds: [aBuild({ id: 1500, buildNumber: 1500 }), aBuild({ id: 1600, buildNumber: 1600 })],
      buildStreams: [
        { buildId: 1500, streamId: STABLE },
        { buildId: 1600, streamId: STABLE },
      ],
    });
    const action: AdminAction = { type: "withdraw-build", buildId: 1500 };
    const result = validateAction(world, action, installed);

    expect(result).toEqual({ ok: true, needsConfirm: false, affectedEmails: [] });
  });

  it.each([
    { name: "buildId is zero", action: { type: "withdraw-build", buildId: 0 } },
    { name: "buildId is negative", action: { type: "restore-build", buildId: -3 } },
    { name: "buildId is not an integer", action: { type: "withdraw-build", buildId: 1.5 } },
    {
      name: "streamId missing",
      action: { type: "remove-build-from-stream", buildId: 1500, streamId: 0 },
    },
    { name: "clientId invalid", action: { type: "unpin-client", clientId: -1 } },
  ])("rejects a malformed action: $name", ({ action }) => {
    const result = validateAction(baseWorld(), action as AdminAction, installed);
    expect(result.ok).toBe(false);
  });
});

describe("validateActions (bulk §13 #3)", () => {
  // Two builds, both the only servable target for one user each. Withdrawing EITHER alone leaves the
  // other build still serving its user; withdrawing BOTH strands both — the union the batch must show.
  function twoChannelWorld() {
    return aWorld({
      clients: [
        aClient({ id: 1, email: "a@example.test" }),
        aClient({ id: 2, email: "b@example.test" }),
      ],
      builds: [aBuild({ id: 1500, buildNumber: 1500 }), aBuild({ id: 1600, buildNumber: 1600 })],
      buildStreams: [
        { buildId: 1500, streamId: 1 },
        { buildId: 1600, streamId: 2 },
      ],
      userStreams: [
        { clientId: 1, streamId: 1 },
        { clientId: 2, streamId: 2 },
      ],
    });
  }

  it("reports the union of users stranded by the whole selection", () => {
    const actions: AdminAction[] = [
      { type: "withdraw-build", buildId: 1500 },
      { type: "withdraw-build", buildId: 1600 },
    ];
    const result = validateActions(twoChannelWorld(), actions);
    expect(result).toEqual({
      ok: true,
      needsConfirm: true,
      affectedEmails: expect.arrayContaining(["a@example.test", "b@example.test"]),
    });
    if (result.ok) expect(result.affectedEmails).toHaveLength(2);
  });

  it("withdrawing only one of the two strands just that build's user", () => {
    const result = validateActions(twoChannelWorld(), [{ type: "withdraw-build", buildId: 1500 }]);
    expect(result).toEqual({
      ok: true,
      needsConfirm: true,
      affectedEmails: ["a@example.test"],
    });
  });

  it("rejects the batch if any action is malformed", () => {
    const result = validateActions(twoChannelWorld(), [
      { type: "withdraw-build", buildId: 1500 },
      { type: "withdraw-build", buildId: 0 },
    ]);
    expect(result.ok).toBe(false);
  });
});
