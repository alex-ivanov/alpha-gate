import { env } from "cloudflare:test";
import { createAccessVerifier, type Jwk } from "../../src/auth/access-jwt";
import { buildDeps, type Deps } from "../../src/deps";
import { createAdminApp } from "../../src/routes/admin";

// A throwaway RS256 keypair + a stub JWKS so tests exercise the real verifier offline (§23). Mirrors
// Cloudflare Access: tokens carry iss/aud/exp and an email (human) or common_name (service token).

export const TEST_TEAM_DOMAIN = "team.example.cloudflareaccess.com";
export const TEST_AUD = "test-aud-tag";
export const TEST_NOW = 1_750_000_000; // fixed unix seconds
export const TEST_ISSUER = `https://${TEST_TEAM_DOMAIN}`;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

export interface TestAccess {
  jwks: Jwk[];
  sign(claims: Record<string, unknown>): Promise<string>;
  validUserClaims(overrides?: Record<string, unknown>): Record<string, unknown>;
  signValidUser(email?: string): Promise<string>;
  signValidService(commonName?: string): Promise<string>;
}

export async function setupTestAccess(): Promise<TestAccess> {
  const { publicKey, privateKey } = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as Jwk;
  jwk.kid = "test-kid";
  jwk.alg = "RS256";
  jwk.use = "sig";

  async function sign(claims: Record<string, unknown>): Promise<string> {
    const header = { alg: "RS256", kid: "test-kid", typ: "JWT" };
    const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(input),
    );
    return `${input}.${b64url(new Uint8Array(signature))}`;
  }

  const base = {
    iss: TEST_ISSUER,
    aud: TEST_AUD,
    iat: TEST_NOW,
    nbf: TEST_NOW - 5,
    exp: TEST_NOW + 3600,
  };

  return {
    jwks: [jwk],
    sign,
    validUserClaims: (overrides = {}) => ({ ...base, email: "admin@example.test", ...overrides }),
    signValidUser: (email = "admin@example.test") => sign({ ...base, email }),
    signValidService: (commonName = "ci-token") => sign({ ...base, common_name: commonName }),
  };
}

/** An Admin Worker on the test env, with the Access verifier pointed at the stub JWKS + fixed time. */
export function adminWorker(access: TestAccess, overrides: Partial<Deps> = {}) {
  const verifier = createAccessVerifier({
    teamDomain: TEST_TEAM_DOMAIN,
    aud: TEST_AUD,
    fetchJwks: async () => access.jwks,
    now: () => TEST_NOW,
  });
  return createAdminApp(() => ({ ...buildDeps(env), access: verifier, ...overrides }));
}

/** Build request init carrying the Access assertion header. */
export function withToken(token: string): RequestInit {
  return { headers: { "Cf-Access-Jwt-Assertion": token } };
}
