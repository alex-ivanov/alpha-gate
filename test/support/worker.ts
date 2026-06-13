import { env } from "cloudflare:test";
import { buildDeps, type Deps } from "../../src/deps";
import { createAppApp } from "../../src/routes/app";

// An App Worker wired to the test env, with any Deps seam overridden (e.g. a fixed clock). Handlers
// read Deps from the context, so requests don't need to pass env.
export function appWorker(overrides: Partial<Deps> = {}) {
  return createAppApp(() => ({ ...buildDeps(env), ...overrides }));
}
