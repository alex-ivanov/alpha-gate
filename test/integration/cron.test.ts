import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runScheduled } from "../../src/cron";
import { insertEvent } from "../../src/db/access-log";
import { buildDeps } from "../../src/deps";
import { cleanDb } from "../support/db";
import { recordingEmailSender } from "../support/email";

// §16/§22 cron dispatch (CUJ-20 prune half). Admin runs the daily job (self-update + anchor + prune);
// the app Worker no-ops the shared cron.
const base = buildDeps(env);
beforeEach(cleanDb);

function depsForCron() {
  return {
    ...base,
    email: recordingEmailSender(),
    fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch,
  };
}

async function accessLogCount(): Promise<number> {
  const row = await base.db.prepare("SELECT COUNT(*) AS n FROM access_log").first<{ n: number }>();
  return row?.n ?? 0;
}

describe("runScheduled", () => {
  it("admin role prunes access-log rows older than retention", async () => {
    await insertEvent(base.db, {
      clientId: 1,
      email: "a@x",
      event: "check",
      createdAt: "2020-01-01T00:00:00Z",
    });
    await insertEvent(base.db, {
      clientId: 1,
      email: "a@x",
      event: "check",
      createdAt: "2099-01-01T00:00:00Z",
    });

    await runScheduled({ ...env, ROLE: "admin", EMAIL_FROM: "" }, depsForCron());

    expect(await accessLogCount()).toBe(1); // only the far-future row survives the 90-day cutoff
  });

  it("app role no-ops the shared cron (nothing pruned)", async () => {
    await insertEvent(base.db, {
      clientId: 1,
      email: "a@x",
      event: "check",
      createdAt: "2020-01-01T00:00:00Z",
    });

    await runScheduled({ ...env, ROLE: "app" }, depsForCron());

    expect(await accessLogCount()).toBe(1); // untouched
  });
});
