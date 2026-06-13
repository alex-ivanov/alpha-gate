import { type AuditFields, linkRow } from "../core/audit-chain";
import { appendIfHead, getHead } from "../db/admin-audit";
import type { Deps } from "../deps";

// §16 — the single entry point admin mutations call to record a tamper-evident audit row. Reads the
// head, links + hashes the new row (core/audit-chain), and appends it guarded on the head being
// unchanged; on contention it retries, so concurrent mutations can never fork the chain.

const MAX_ATTEMPTS = 5;

export async function recordAudit(deps: Deps, fields: AuditFields): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const head = await getHead(deps.db);
    const prevHash = head?.hash ?? null;
    const row = await linkRow(prevHash, fields);
    if (await appendIfHead(deps.db, row, prevHash)) return;
  }
  throw new Error("audit chain write contention");
}
