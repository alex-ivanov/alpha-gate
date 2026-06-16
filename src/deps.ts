import {
  type AccessVerifier,
  createAccessVerifier,
  createCachedJwksFetcher,
} from "./auth/access-jwt";
import type { Env } from "./env";
import { type Clock, emailDate, nowSeconds, systemClock } from "./lib/clock";
import { type EmailSender, selectEmailSender } from "./services/email";

// The dependency-injection container (the Deps DI rule; see CONTRIBUTING.md). Handlers and services
// receive `Deps` and never import bindings or seams directly, so tests swap each seam.

// decision 0006 — ONE JWKS cache for the whole isolate (module scope, not per-request), so Access
// verification reuses fetched keys across requests and only re-fetches on TTL expiry or an unknown kid.
const cachedFetchJwks = createCachedJwksFetcher({ now: nowSeconds });

export interface Deps {
  db: D1Database;
  r2: R2Bucket;
  clock: Clock;
  access: AccessVerifier;
  email: EmailSender;
  fetch: typeof fetch; // outbound HTTP for the self-update manifest (§22); mocked in tests
}

/** Production wiring, built once at the worker entry from the runtime env. */
export function buildDeps(env: Env): Deps {
  return {
    db: env.DB,
    r2: env.BUILDS,
    clock: systemClock,
    access: createAccessVerifier({
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
      fetchJwks: cachedFetchJwks,
      now: nowSeconds,
    }),
    email: selectEmailSender(env, emailDate),
    fetch: globalThis.fetch,
  };
}
