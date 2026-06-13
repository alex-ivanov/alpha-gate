import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuditFields } from "../../src/core/audit-chain";
import { get as metaGet } from "../../src/db/meta";
import { buildDeps } from "../../src/deps";
import { anchorAudit } from "../../src/services/anchor";
import { recordAudit } from "../../src/services/audit";
import { cleanDb } from "../support/db";
import { recordingEmailSender } from "../support/email";

// CUJ-19 (§16) — Audit anchor + tamper detection. The daily anchor records the chain head off-box
// (R2 + an owner email) and flags tampering since the last anchor: truncation, divergence, or a chain
// that no longer verifies.
const base = buildDeps(env);
beforeEach(cleanDb);

function fields(action: string): AuditFields {
  return {
    actorEmail: "admin@example.test",
    action,
    target: null,
    detail: null,
    ip: null,
    rayId: null,
    createdAt: "2026-06-13T12:00:00Z",
  };
}

describe("CUJ-19 audit anchor", () => {
  it("anchors the head to R2 + meta and reports an intact chain", async () => {
    await recordAudit(base, fields("a"));
    await recordAudit(base, fields("b"));
    await recordAudit(base, fields("c"));

    const email = recordingEmailSender();
    const result = await anchorAudit(
      { ...base, email },
      { now: "2026-06-13T00:00:00Z", ownerEmail: "owner@x" },
    );

    expect(result.count).toBe(3);
    expect(result.intact).toBe(true);
    expect(await metaGet(base.db, "audit_anchor_head")).not.toBeNull();
    expect(await (await base.r2.get("audit/anchor/2026-06-13T00:00:00Z.json"))?.text()).toContain(
      '"count":3',
    );
    expect(email.outbox).toHaveLength(1);
  });

  it("detects truncation of the newest rows since the last anchor", async () => {
    await recordAudit(base, fields("a"));
    await recordAudit(base, fields("b"));
    await recordAudit(base, fields("c"));
    await anchorAudit(
      { ...base, email: recordingEmailSender() },
      { now: "2026-06-13T00:00:00Z", ownerEmail: null },
    );

    // Tamper: delete the newest audit row.
    await base.db
      .prepare("DELETE FROM admin_audit WHERE id = (SELECT MAX(id) FROM admin_audit)")
      .run();

    const result = await anchorAudit(
      { ...base, email: recordingEmailSender() },
      { now: "2026-06-14T00:00:00Z", ownerEmail: null },
    );
    expect(result.intact).toBe(false);
  });

  it("detects a mid-chain edit (the chain no longer verifies)", async () => {
    await recordAudit(base, fields("a"));
    await recordAudit(base, fields("b"));

    // Tamper: rewrite the first row's action without recomputing its hash.
    await base.db
      .prepare(
        "UPDATE admin_audit SET action = 'forged' WHERE id = (SELECT MIN(id) FROM admin_audit)",
      )
      .run();

    const result = await anchorAudit(
      { ...base, email: recordingEmailSender() },
      { now: "2026-06-13T00:00:00Z", ownerEmail: null },
    );
    expect(result.intact).toBe(false);
  });
});
