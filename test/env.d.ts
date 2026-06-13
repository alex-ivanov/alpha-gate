/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Test-only additions to the worker env: the migrations array stashed as a binding by the vitest
// config and applied in setup.ts. Merges into the same `Cloudflare.Env` declared in src/env.ts.
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
