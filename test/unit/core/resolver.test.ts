import { describe, expect, it } from "vitest";
import type { ResolveInput, ResolverResult } from "../../../src/core/resolver";
import { resolve } from "../../../src/core/resolver";
import { aBuild, aClient } from "../../support/factories";

// §8 resolver — the pivotal pure function. Everything (appcast, /download target, §11 no-build
// preview) hangs off this. One decision table covers the whole space; each row names the §8/§11/§12
// behavior it pins down. Read the `expect` column as the contract.

/** Compact, human-readable summary of a result for table assertions. */
function outcome(result: ResolverResult): string {
  switch (result.kind) {
    case "target":
      return `target:${result.build.buildNumber}`;
    case "informational":
      return `informational:${result.reason}`;
    case "none":
      return "none";
  }
}

describe("resolve", () => {
  // Builds used across rows.
  const b1400 = aBuild({ id: 1400, buildNumber: 1400 });
  const b1500 = aBuild({ id: 1500, buildNumber: 1500 });
  const b1600 = aBuild({ id: 1600, buildNumber: 1600 });
  const b1500withdrawn = aBuild({ id: 1500, buildNumber: 1500, status: "withdrawn" });

  const STABLE = 1;
  const BETA = 2;

  const cases: { name: string; input: ResolveInput; expect: string }[] = [
    {
      name: "unknown token (no client row) → informational/unknown, not 403 (§3, §15)",
      input: { client: null, builds: [], buildStreams: [], clientStreamIds: [] },
      expect: "informational:unknown",
    },
    {
      name: "revoked client → informational/revoke notice (§6, §15)",
      input: {
        client: aClient({ status: "revoked" }),
        builds: [b1500],
        buildStreams: [{ buildId: 1500, streamId: STABLE }],
        clientStreamIds: [STABLE],
      },
      expect: "informational:revoked",
    },
    {
      name: "single stream, one available build → that build (§8.3, CUJ-1)",
      input: {
        client: aClient(),
        builds: [b1500],
        buildStreams: [{ buildId: 1500, streamId: STABLE }],
        clientStreamIds: [STABLE],
      },
      expect: "target:1500",
    },
    {
      name: "highest build_number wins within a stream — numeric, not lexical (§8.3)",
      input: {
        client: aClient(),
        builds: [b1400, b1500],
        buildStreams: [
          { buildId: 1400, streamId: STABLE },
          { buildId: 1500, streamId: STABLE },
        ],
        clientStreamIds: [STABLE],
      },
      expect: "target:1500",
    },
    {
      name: "highest across ALL the client's streams (§8.3, CUJ-8: stable+beta → #1600)",
      input: {
        client: aClient(),
        builds: [b1500, b1600],
        buildStreams: [
          { buildId: 1500, streamId: STABLE },
          { buildId: 1600, streamId: BETA },
        ],
        clientStreamIds: [STABLE, BETA],
      },
      expect: "target:1600",
    },
    {
      name: "build exists but only in a stream the client is NOT in → none (§8.3)",
      input: {
        client: aClient(),
        builds: [b1600],
        buildStreams: [{ buildId: 1600, streamId: BETA }],
        clientStreamIds: [STABLE],
      },
      expect: "none",
    },
    {
      name: "client assigned to no streams → none (§11 empty)",
      input: { client: aClient(), builds: [b1500], buildStreams: [], clientStreamIds: [] },
      expect: "none",
    },
    {
      name: "all builds in the client's streams are withdrawn → none (§11)",
      input: {
        client: aClient(),
        builds: [b1500withdrawn],
        buildStreams: [{ buildId: 1500, streamId: STABLE }],
        clientStreamIds: [STABLE],
      },
      expect: "none",
    },
    {
      name: "pinned to an available build → that build, overriding newer stream builds (§8.2, CUJ-9)",
      input: {
        client: aClient({ pinnedBuildId: 1500 }),
        builds: [b1500, b1600],
        buildStreams: [
          { buildId: 1500, streamId: STABLE },
          { buildId: 1600, streamId: STABLE },
        ],
        clientStreamIds: [STABLE],
      },
      expect: "target:1500",
    },
    {
      name: "pinned to a withdrawn build → none, does NOT fall back to streams (§11)",
      input: {
        client: aClient({ pinnedBuildId: 1500 }),
        builds: [b1500withdrawn, b1600],
        buildStreams: [
          { buildId: 1500, streamId: STABLE },
          { buildId: 1600, streamId: STABLE },
        ],
        clientStreamIds: [STABLE],
      },
      expect: "none",
    },
    {
      name: "pinned to a build that no longer exists → none (defensive)",
      input: {
        client: aClient({ pinnedBuildId: 9999 }),
        builds: [b1600],
        buildStreams: [{ buildId: 1600, streamId: STABLE }],
        clientStreamIds: [STABLE],
      },
      expect: "none",
    },
  ];

  it.each(cases)("$name", ({ input, expect: expected }) => {
    expect(outcome(resolve(input))).toBe(expected);
  });
});
