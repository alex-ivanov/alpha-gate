import { beforeAll, describe, expect, it } from "vitest";
import { type Jwk, verifyAccessJwt } from "../../../src/auth/access-jwt";
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
