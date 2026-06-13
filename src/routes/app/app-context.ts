import type { Context } from "hono";
import type { Deps } from "../../deps";
import type { Env } from "../../env";

// The Hono realization of the Deps rule: a middleware puts Deps on the context, handlers read it via
// c.get("deps") and never touch bindings directly. One type shared by every app-side handler.
export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };
export type AppContext = Context<AppEnv>;
