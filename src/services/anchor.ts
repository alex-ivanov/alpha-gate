import { buildHead, verifyChain } from "../core/audit-chain";
import { listInOrder } from "../db/admin-audit";
import * as meta from "../db/meta";
import type { Deps } from "../deps";
import { putAuditAnchor } from "../r2/builds-bucket";
import { auditAnchorKey } from "../r2/keys";

// §16 — the daily audit anchor. Records the current chain head where the running admin can't silently
// rewrite it (an append-only R2 object + an owner email), and detects tampering since the last anchor:
// a chain that no longer verifies, is shorter (truncation), or whose old head hash no longer matches
// the row at that position (divergence/rebuild) is flagged.

export interface AnchorResult {
  hash: string;
  count: number;
  intact: boolean;
}

interface AnchoredHead {
  hash: string;
  count: number;
}

export async function anchorAudit(
  deps: Deps,
  opts: { now: string; ownerEmail: string | null },
): Promise<AnchorResult> {
  const rows = await listInOrder(deps.db);
  const verified = (await verifyChain(rows)).ok;
  const head = buildHead(rows);

  let intact = verified;
  const priorRaw = await meta.get(deps.db, "audit_anchor_head");
  if (priorRaw !== null) {
    const prior = JSON.parse(priorRaw) as AnchoredHead;
    if (head.count < prior.count) {
      intact = false; // truncation — newest rows removed
    } else if (prior.count > 0 && rows[prior.count - 1]?.hash !== prior.hash) {
      intact = false; // divergence / rebuild
    }
  }

  const anchor = { hash: head.hash, count: head.count, at: opts.now, intact };
  await putAuditAnchor(deps.r2, auditAnchorKey(opts.now), JSON.stringify(anchor));
  await meta.set(
    deps.db,
    "audit_anchor_head",
    JSON.stringify({ hash: head.hash, count: head.count }),
  );

  if (opts.ownerEmail !== null) {
    await deps.email.send({
      to: opts.ownerEmail,
      subject: intact
        ? `Alpha Gate audit anchor (${head.count} rows)`
        : "Alpha Gate audit ANCHOR MISMATCH",
      body: JSON.stringify(anchor),
    });
  }

  return { hash: head.hash, count: head.count, intact };
}
