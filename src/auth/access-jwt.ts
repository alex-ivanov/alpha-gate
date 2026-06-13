// §4 / decision 0006 — Cloudflare Access JWT verification, the security boundary for every admin
// mutation. Fail CLOSED on any error. alg pinned to RS256 (algorithm-confusion defense); iss/aud
// checked; ±60s clock skew; the JWKS fetch is an injectable seam so tests use a throwaway keypair.
// A human one-time-PIN JWT carries `email`; a service-token JWT carries `common_name` (no email).

export interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  [key: string]: unknown;
}

export type AccessIdentity =
  | { kind: "user"; email: string }
  | { kind: "service"; commonName: string };

export type AccessResult = AccessIdentity | { kind: "reject"; reason: string };

const SKEW_SECONDS = 60;
const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

const reject = (reason: string): AccessResult => ({ kind: "reject", reason });

export interface VerifyOptions {
  jwks: readonly Jwk[];
  now: number; // unix seconds
  aud: string;
  issuer: string;
}

/** The pure-ish verifier: crypto + claims against a supplied JWKS. No network. */
export async function verifyAccessJwt(token: string, opts: VerifyOptions): Promise<AccessResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return reject("malformed token");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  let signature: Uint8Array;
  try {
    header = JSON.parse(decodeText(encodedHeader)) as Record<string, unknown>;
    payload = JSON.parse(decodeText(encodedPayload)) as Record<string, unknown>;
    signature = decodeBytes(encodedSignature);
  } catch {
    return reject("unparseable token");
  }

  if (header.alg !== "RS256") return reject("alg not RS256");
  const kid = typeof header.kid === "string" ? header.kid : null;
  const jwk = opts.jwks.find((k) => k.kid === kid) ?? (kid === null ? opts.jwks[0] : undefined);
  if (jwk === undefined) return reject("unknown kid");

  let valid: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  } catch {
    return reject("verification error");
  }
  if (!valid) return reject("bad signature");

  if (payload.iss !== opts.issuer) return reject("issuer mismatch");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(opts.aud)) return reject("audience mismatch");
  if (typeof payload.exp === "number" && opts.now > payload.exp + SKEW_SECONDS) {
    return reject("expired");
  }
  if (typeof payload.nbf === "number" && opts.now < payload.nbf - SKEW_SECONDS) {
    return reject("not yet valid");
  }

  if (typeof payload.email === "string" && payload.email.length > 0) {
    return { kind: "user", email: payload.email };
  }
  if (typeof payload.common_name === "string" && payload.common_name.length > 0) {
    return { kind: "service", commonName: payload.common_name };
  }
  return reject("no principal claim");
}

export interface AccessVerifier {
  verify(headers: Headers): Promise<AccessResult>;
}

export interface AccessConfig {
  teamDomain: string | undefined;
  aud: string | undefined;
  fetchJwks: (teamDomain: string) => Promise<readonly Jwk[]>;
  now: () => number;
}

/**
 * The Deps seam. Reads the Access assertion header, fetches the team JWKS (behind fetchJwks), and
 * verifies — failing closed on missing config, a missing header, or a JWKS fetch failure. (A
 * cross-request JWKS cache is a perf optimization deferred for the alpha; fetching fresh per request
 * is correct and naturally handles key rotation.)
 */
export function createAccessVerifier(config: AccessConfig): AccessVerifier {
  return {
    async verify(headers: Headers): Promise<AccessResult> {
      if (config.teamDomain === undefined || config.aud === undefined) {
        return reject("Access not configured");
      }
      const token = headers.get(ACCESS_HEADER);
      if (token === null || token.length === 0) return reject("missing Access assertion");

      let jwks: readonly Jwk[];
      try {
        jwks = await config.fetchJwks(config.teamDomain);
      } catch {
        return reject("JWKS fetch failed");
      }

      return verifyAccessJwt(token, {
        jwks,
        now: config.now(),
        aud: config.aud,
        issuer: `https://${config.teamDomain}`,
      });
    },
  };
}

export async function defaultFetchJwks(teamDomain: string): Promise<readonly Jwk[]> {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch returned ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
}

function decodeBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeText(base64url: string): string {
  return new TextDecoder().decode(decodeBytes(base64url));
}
