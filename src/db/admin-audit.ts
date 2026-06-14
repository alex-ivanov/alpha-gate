import type { AuditRow } from "../core/audit-chain";
import { executeWithChanges, queryAll, queryOne } from "./client";

// §16 — admin_audit persistence. Storage only: the hash is computed in core/audit-chain and passed in.
// appendIfHead is a conditional insert guarded on the chain head being unchanged, so two concurrent
// writers can't fork the chain (the loser inserts 0 rows and retries — see services/audit.ts).

interface AuditDbRow {
  id: number;
  actor_email: string;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  ray_id: string | null;
  prev_hash: string | null;
  hash: string;
  created_at: string;
}

function toAuditRow(row: AuditDbRow): AuditRow {
  return {
    actorEmail: row.actor_email,
    action: row.action,
    target: row.target,
    detail: row.detail,
    ip: row.ip,
    rayId: row.ray_id,
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

export async function getHead(db: D1Database): Promise<AuditRow | null> {
  const row = await queryOne<AuditDbRow>(db, "SELECT * FROM admin_audit ORDER BY id DESC LIMIT 1");
  return row ? toAuditRow(row) : null;
}

export async function listInOrder(db: D1Database): Promise<AuditRow[]> {
  const rows = await queryAll<AuditDbRow>(db, "SELECT * FROM admin_audit ORDER BY id");
  return rows.map(toAuditRow);
}

export interface AuditFilter {
  actor?: string | undefined;
  action?: string | undefined;
  limit?: number;
}

/** Newest-first, optionally filtered by actor/action — for the §13 #15 audit page. */
export async function listForDisplay(
  db: D1Database,
  filter: AuditFilter = {},
): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.actor) {
    where.push("actor_email = ?");
    params.push(filter.actor);
  }
  if (filter.action) {
    where.push("action = ?");
    params.push(filter.action);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await queryAll<AuditDbRow>(
    db,
    `SELECT * FROM admin_audit ${clause} ORDER BY id DESC LIMIT ?`,
    [...params, filter.limit ?? 200],
  );
  return rows.map(toAuditRow);
}

/** Inserts only if the current head hash still equals expectedHeadHash. Returns whether it inserted. */
export async function appendIfHead(
  db: D1Database,
  row: AuditRow,
  expectedHeadHash: string | null,
): Promise<boolean> {
  const changes = await executeWithChanges(
    db,
    `INSERT INTO admin_audit (actor_email, action, target, detail, ip, ray_id, prev_hash, hash, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE COALESCE((SELECT hash FROM admin_audit ORDER BY id DESC LIMIT 1), '') = ?`,
    [
      row.actorEmail,
      row.action,
      row.target,
      row.detail,
      row.ip,
      row.rayId,
      row.prevHash,
      row.hash,
      row.createdAt,
      expectedHeadHash ?? "",
    ],
  );
  return changes > 0;
}
