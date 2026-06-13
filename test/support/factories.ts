import type { World } from "../../src/core/no-build";
import type { Build, Client, Stream } from "../../src/core/types";

// Plain-data builders for the pure-core tests. Sensible defaults, override what the case is about —
// so each test row reads as "a client like X, a build like Y" with only the relevant fields stated.

const EPOCH = "2026-01-01T00:00:00Z";

export function aClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    email: "user@example.test",
    token: "T".repeat(32),
    status: "active",
    pinnedBuildId: null,
    label: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

export function aBuild(overrides: Partial<Build> = {}): Build {
  const buildNumber = overrides.buildNumber ?? 1000;
  return {
    id: buildNumber,
    shortVersion: "1.0.0",
    buildNumber,
    objectKey: `build/${buildNumber}/App.zip`,
    edSignature: "ed-signature",
    length: 1024,
    minOs: null,
    critical: false,
    status: "available",
    dmgObjectKey: null,
    dmgLength: null,
    createdAt: EPOCH,
    ...overrides,
  };
}

export function aStream(overrides: Partial<Stream> = {}): Stream {
  return { id: 1, name: "stable", ...overrides };
}

export function aWorld(overrides: Partial<World> = {}): World {
  return { clients: [], builds: [], buildStreams: [], userStreams: [], ...overrides };
}
