import type { Env } from "./env";
import { type Clock, systemClock } from "./lib/clock";

// The dependency-injection container (CANONICAL-LAYOUT rule 1). Handlers and services receive `Deps`
// and never import bindings or seams directly, so tests swap each seam. It grows as consumers land:
// `access` (Access JWT verifier) arrives in M11, `email` in M12, `fetch` (self-update) in M16.

export interface Deps {
  db: D1Database;
  r2: R2Bucket;
  clock: Clock;
}

/** Production wiring, built once at the worker entry from the runtime env. */
export function buildDeps(env: Env): Deps {
  return {
    db: env.DB,
    r2: env.BUILDS,
    clock: systemClock,
  };
}
