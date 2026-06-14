import { createAccessVerifier, type Jwk } from "../auth/access-jwt";
import { buildDeps } from "../deps";
import type { Env } from "../env";
import { nowSeconds } from "../lib/clock";
import { createAdminApp } from "../routes/admin";

// LOCAL-DEV ONLY (§23). A throwaway Worker entrypoint that lets the gated Admin Worker be opened in a
// browser on localhost WITHOUT Cloudflare Access in front of it. It runs the REAL admin app and the
// REAL Access verifier (decision 0006) — only the trust anchor is swapped: a throwaway RSA keypair is
// minted in-process, and a dev-signed assertion is auto-injected on requests that lack the header
// (a browser cannot send Cf-Access-Jwt-Assertion; the Cloudflare edge normally adds it).
//
// SAFETY: this file is NEVER imported by src/worker.ts and NEVER referenced by the deploy template
// (deploy.sh fixes main=../src/worker.ts), so a normal deploy cannot ship it. As belt-and-suspenders it
// also refuses to serve unless env.DEV_ADMIN === "1", which only deploy/dev.sh sets. Effect while
// running: anyone who can reach the local port is admin "dev@local" — localhost only. Never deploy.

const DEV_TEAM_DOMAIN = "dev.localhost.cloudflareaccess.test";
const DEV_AUD = "alpha-gate-local-dev";
const DEV_EMAIL = "dev@local";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function b64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return b64url(binary);
}

// Mint the dev keypair + a long-lived assertion once per isolate, and build the admin app against a
// verifier pointed at that key. Memoized so the keygen cost is paid once, not per request.
let initPromise: Promise<{ app: ReturnType<typeof createAdminApp>; token: string }> | null = null;

function init(): Promise<{ app: ReturnType<typeof createAdminApp>; token: string }> {
  if (initPromise === null) {
    initPromise = (async () => {
      const pair = (await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
      jwk.kid = "dev-kid";
      jwk.alg = "RS256";
      jwk.use = "sig";

      const now = nowSeconds();
      const header = b64url(JSON.stringify({ alg: "RS256", kid: "dev-kid", typ: "JWT" }));
      const payload = b64url(
        JSON.stringify({
          iss: `https://${DEV_TEAM_DOMAIN}`,
          aud: DEV_AUD,
          email: DEV_EMAIL,
          iat: now,
          nbf: now - 5,
          exp: now + ONE_YEAR_SECONDS,
        }),
      );
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(`${header}.${payload}`),
      );
      const token = `${header}.${payload}.${b64urlBytes(new Uint8Array(signature))}`;

      const verifier = createAccessVerifier({
        teamDomain: DEV_TEAM_DOMAIN,
        aud: DEV_AUD,
        fetchJwks: async () => [jwk],
        now: nowSeconds,
      });
      const app = createAdminApp((env) => ({ ...buildDeps(env), access: verifier }));
      return { app, token };
    })();
  }
  return initPromise;
}

export default {
  async fetch(
    request: Request,
    env: Env & { DEV_ADMIN?: string },
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (env.DEV_ADMIN !== "1") {
      return new Response(
        "Refused: src/dev/admin-entry.ts is a local-dev-only entrypoint (DEV_ADMIN!=1). Never deploy it.",
        { status: 500 },
      );
    }
    const { app, token } = await init();
    const headers = new Headers(request.headers);
    if (!headers.has("Cf-Access-Jwt-Assertion")) headers.set("Cf-Access-Jwt-Assertion", token);
    return app.fetch(new Request(request, { headers }), env, ctx);
  },
};
