# 0006 — Cloudflare Access JWT verification

**Status:** accepted · **Date:** 2026-06-13

## Context
§4 says validate `Cf-Access-Jwt-Assertion` against the team certs, check `aud` + email, fail closed;
§23 says verification sits behind an injectable verifier. JWKS caching, clock skew, algorithm pinning,
and the service-token (CI) path are unspecified — yet §13 has `/admin/builds/upload` accept "admin
session **or** Access service token".

## Decision
One pure-ish `verifyAccess(headers, { jwksFetcher, aud, teamDomain, now }) → AccessIdentity | AccessReject`
with the JWKS fetch behind a seam (`Deps.access`):
- **Pin `alg = RS256`**; reject `alg: none` and any other algorithm (algorithm-confusion defense).
- Verify `iss == https://<ACCESS_TEAM_DOMAIN>` and `aud` contains `ACCESS_AUD`.
- **±60 s** clock skew on `exp`/`nbf`/`iat`.
- **JWKS cached by `kid` in Worker global scope** with a short TTL (~10–15 min); force a refetch on an
  unknown `kid` (survives Cloudflare key rotation without per-request fetches).
- **Caller type from claims:** a human one-time-PIN JWT carries `email`; a service-token JWT carries
  `common_name` and no `email`.
- **Fail CLOSED** on any error (missing/expired/bad-sig/wrong-aud/wrong-iss/JWKS-unreachable).

## Consequences
- **One middleware mount** for all `/admin/*` — a new route cannot forget verification (structural test
  asserts this). Actor identity is derived only from verified claims, never a raw header.
- **Service-token scope:** accepted **only** on `/admin/builds/upload` and `/admin/builds/register`
  (CI's job). Every other mutation requires an `email` JWT. A leaked CI credential is thus bounded to
  publishing builds. `common_name` is recorded as the actor in `admin_audit` for CI uploads.
- Tests cover: valid email JWT, missing/expired/bad-sig/wrong-aud/wrong-iss/alg:none/non-RS256,
  JWKS-unreachable, unknown-kid refetch, and the service-token path — via a throwaway RS256 keypair +
  stub JWKS (`test/support/access.ts`).
