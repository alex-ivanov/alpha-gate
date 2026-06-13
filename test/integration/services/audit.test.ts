import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuditFields, linkRow, verifyChain } from "../../../src/core/audit-chain";
import { appendIfHead, getHead, listInOrder } from "../../../src/db/admin-audit";
import { buildDeps } from "../../../src/deps";
import { recordAudit } from "../../../src/services/audit";
import { cleanDb } from "../../support/db";

const deps = buildDeps(env);
beforeEach(cleanDb);

function fields(action: string, target: string | null = null): AuditFields {
  return {
    actorEmail: "admin@example.test",
    action,
    target,
    detail: null,
    ip: "203.0.113.1",
    rayId: "ray-1",
    createdAt: "2026-06-13T12:00:00Z",
  };
}

describe("recordAudit", () => {
  it("appends rows that form a valid, linked chain", async () => {
    await recordAudit(deps, fields("client.revoke", "a@x"));
    await recordAudit(deps, fields("build.withdraw", "1500"));

    const rows = await listInOrder(deps.db);
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(first?.prevHash).toBeNull();
    expect(second?.prevHash).toBe(first?.hash);
    expect(await verifyChain(rows)).toEqual({ ok: true });
  });

  it("refuses a stale conditional append so the chain can't fork", async () => {
    await recordAudit(deps, fields("first"));
    const head = await getHead(deps.db);

    // A racer that linked against an empty chain (expectedHead = null) after a row already exists.
    const stale = await linkRow(null, fields("racer"));
    expect(await appendIfHead(deps.db, stale, null)).toBe(false);

    expect((await getHead(deps.db))?.hash).toBe(head?.hash); // head unchanged
  });
});
