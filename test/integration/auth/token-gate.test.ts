import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { gateToken } from "../../../src/auth/token-gate";
import { generateToken } from "../../../src/core/tokens";
import { insert, setStatus } from "../../../src/db/clients";
import { buildDeps } from "../../../src/deps";
import { cleanDb } from "../../support/db";

const deps = buildDeps(env);

beforeEach(cleanDb);

describe("gateToken", () => {
  it("returns the client for an active token", async () => {
    const token = generateToken();
    const client = await insert(deps.db, { email: "a@example.test", token });

    const result = await gateToken(deps, token);
    expect(result.kind).toBe("active");
    expect(result.kind === "active" && result.client.id).toBe(client.id);
  });

  it("matches case-insensitively (a lower-cased paste still resolves)", async () => {
    const token = generateToken();
    await insert(deps.db, { email: "a@example.test", token });

    const result = await gateToken(deps, token.toLowerCase());
    expect(result.kind).toBe("active");
  });

  it("reports revoked (carrying the client) for a revoked token", async () => {
    const token = generateToken();
    const client = await insert(deps.db, { email: "a@example.test", token });
    await setStatus(deps.db, client.id, "revoked");

    const result = await gateToken(deps, token);
    expect(result.kind).toBe("revoked");
  });

  it("reports unknown for an unknown, malformed, or absent token (no existence leak)", async () => {
    expect((await gateToken(deps, generateToken())).kind).toBe("unknown"); // well-formed, not in DB
    expect((await gateToken(deps, "not-a-real-token!!")).kind).toBe("unknown"); // malformed
    expect((await gateToken(deps, null)).kind).toBe("unknown");
  });
});
