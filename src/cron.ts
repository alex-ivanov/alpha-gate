import { prune } from "./db/access-log";
import { buildDeps, type Deps } from "./deps";
import type { Env } from "./env";
import { isoDaysAgo } from "./lib/clock";
import { anchorAudit } from "./services/anchor";
import { checkSelfUpdate } from "./services/self-update";

// §16/§22 — the daily scheduled job. Only the admin Worker acts; the app Worker shares the cron
// config but no-ops. Deps is injectable so tests drive it with a mocked fetch / recording email.

const LOG_RETENTION_DAYS = 90;

export async function runScheduled(env: Env, deps: Deps = buildDeps(env)): Promise<void> {
  if (env.ROLE !== "admin") return; // the app Worker no-ops the shared cron

  const ownerEmail = env.EMAIL_FROM.length > 0 ? env.EMAIL_FROM : null;

  await checkSelfUpdate(deps, {
    toolVersion: env.TOOL_VERSION,
    manifestUrl: env.UPDATE_MANIFEST_URL,
    ownerEmail,
  });
  await anchorAudit(deps, { now: deps.clock(), ownerEmail });
  await prune(deps.db, isoDaysAgo(LOG_RETENTION_DAYS));
}
