import type { Context } from "hono";
import type { AccessIdentity } from "../../auth/access-jwt";
import type { Deps } from "../../deps";
import type { Env } from "../../env";

// The admin-side context: Deps plus the verified actor (set by the auth middleware). Handlers read
// the actor for authorization decisions and audit attribution — never from a raw header.
export type AdminEnv = { Bindings: Env; Variables: { deps: Deps; actor: AccessIdentity } };
export type AdminContext = Context<AdminEnv>;
