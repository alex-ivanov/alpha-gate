import { beforeAll, describe, expect, it } from "vitest";
import {
  createCachedJwksFetcher,
  extractKid,
  type Jwk,
  verifyAccessJwt,
} from "../../../src/auth/access-jwt";
import {
  setupTestAccess,
  TEST_AUD,
  TEST_ISSUER,
  TEST_NOW,
  type TestAccess,
} from "../../support/access";

// decision 0006 — the verifier must FAIL CLOSED on every bad path. A throwaway keypair signs real
// RS256 tokens; we then assert the full accept/reject truth table.

let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});

const opts = (jwksOverride?: Jwk[]) => ({
  jwks: jwksOverride ?? access.jwks,
  now: TEST_NOW,
  aud: TEST_AUD,
  issuer: TEST_ISSUER,
});

describe("verifyAccessJwt", () => {
  it("accepts a valid human token and returns the email", async () => {
    const result = await verifyAccessJwt(await access.signValidUser("admin@example.test"), opts());
    expect(result).toEqual({ kind: "user", email: "admin@example.test" });
  });

  it("accepts a valid service token and returns the common name", async () => {
    const result = await verifyAccessJwt(await access.signValidService("ci-bot"), opts());
    expect(result).toEqual({ kind: "service", commonName: "ci-bot" });
  });

  it("rejects an expired token", async () => {
    const token = await access.sign(access.validUserClaims({ exp: TEST_NOW - 4000 }));
    expect((await verifyAccessJwt(token, opts())).kind).toBe("reject");
  });

  it("rejects a token with no exp claim (fail closed, not never-expiring)", async () => {
    const token = await access.sign({
      iss: TEST_ISSUER,
      aud: TEST_AUD,
      iat: TEST_NOW,
      email: "x@y",
    });
    expect((await verifyAccessJwt(token, opts())).kind).toBe("reject");
  });

  it("rejects a token with a non-numeric exp", async () => {
    const token = await access.sign(access.validUserClaims({ exp: "soon" }));
    expect((await verifyAccessJwt(token, opts())).kind).toBe("reject");
  });

  it("rejects a token issued in the future (iat skew)", async () => {
    const token = await access.sign(access.validUserClaims({ iat: TEST_NOW + 4000 }));
    expect((await verifyAccessJwt(token, opts())).kind).toBe("reject");
  });

  it("rejects a not-yet-valid token", async () => {
    const token = await access.sign(access.validUserClaims({ nbf: TEST_NOW + 4000 }));
    expect((await verifyAccessJwt(token, opts())).kind).toBe("reject");
  });

  it("rejects a wrong audience", async () => {
    const token = await access.sign(access.validUserClaims({ aud: "some-other-app" }));
    expect((await verifyAccessJwt(token, opts())).kind).toBe("reject");
  });

  it("rejects a wrong issuer", async () => {
    const token = await access.sign(access.validUserClaims({ iss: "https://evil.example" }));
    expect((await verifyAccessJwt(token, opts())).kind).toBe("reject");
  });

  it("rejects alg:none (algorithm-confusion defense)", async () => {
    const part = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const unsigned = `${part({ alg: "none", kid: "test-kid", typ: "JWT" })}.${part(
      access.validUserClaims(),
    )}.`;
    expect((await verifyAccessJwt(unsigned, opts())).kind).toBe("reject");
  });

  it("rejects a tampered signature", async () => {
    const token = await access.signValidUser();
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect((await verifyAccessJwt(tampered, opts())).kind).toBe("reject");
  });

  it("rejects when no key matches the kid", async () => {
    expect((await verifyAccessJwt(await access.signValidUser(), opts([]))).kind).toBe("reject");
  });

  it("rejects a structurally malformed token", async () => {
    expect((await verifyAccessJwt("not.a.jwt", opts())).kind).toBe("reject");
    expect((await verifyAccessJwt("garbage", opts())).kind).toBe("reject");
  });
});

describe("extractKid", () => {
  it("reads the kid from a real signed token's header", async () => {
    expect(extractKid(await access.signValidUser())).toBe("test-kid");
  });

  it("returns null for a token with no kid or a garbled header", () => {
    expect(extractKid("garbage")).toBeNull();
    expect(extractKid("")).toBeNull();
  });
});

describe("createCachedJwksFetcher (decision 0006)", () => {
  const KEYS: Jwk[] = [{ kid: "k1" }, { kid: "k2" }];

  function counter() {
    const state = { calls: 0 };
    const fetchJwks = async () => {
      state.calls++;
      return KEYS;
    };
    return { state, fetchJwks };
  }

  it("serves from cache within the TTL (one network fetch for repeated calls)", async () => {
    const { state, fetchJwks } = counter();
    let clock = 1000;
    const get = createCachedJwksFetcher({ now: () => clock, fetchJwks, ttlSeconds: 600 });

    await get("team", { kid: "k1" });
    clock = 1500; // still within 600s
    await get("team", { kid: "k2" });

    expect(state.calls).toBe(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    const { state, fetchJwks } = counter();
    let clock = 1000;
    const get = createCachedJwksFetcher({ now: () => clock, fetchJwks, ttlSeconds: 600 });

    await get("team", { kid: "k1" });
    clock = 1000 + 601; // past the TTL
    await get("team", { kid: "k1" });

    expect(state.calls).toBe(2);
  });

  it("forces a refetch when an unknown kid is requested, even within the TTL", async () => {
    const { state, fetchJwks } = counter();
    const get = createCachedJwksFetcher({ now: () => 1000, fetchJwks, ttlSeconds: 600 });

    await get("team", { kid: "k1" }); // populates cache
    await get("team", { kid: "rotated-in" }); // not in cached set → refetch

    expect(state.calls).toBe(2);
  });

  it("caches per team domain independently", async () => {
    const { state, fetchJwks } = counter();
    const get = createCachedJwksFetcher({ now: () => 1000, fetchJwks });

    await get("team-a", { kid: "k1" });
    await get("team-b", { kid: "k1" });
    await get("team-a", { kid: "k1" });

    expect(state.calls).toBe(2); // one per domain; the third is a cache hit
  });
});
