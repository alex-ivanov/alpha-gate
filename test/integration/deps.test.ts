import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildDeps } from "../../src/deps";

describe("buildDeps", () => {
  it("wires the runtime bindings and a working clock", () => {
    const deps = buildDeps(env);

    expect(deps.db).toBe(env.DB);
    expect(deps.r2).toBe(env.BUILDS);
    expect(deps.clock()).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
  });
});
