import { execute, queryAll, queryOne } from "./client";

// §13 #10 — pending access requests submitted from the public /access page.

export interface AccessRequest {
  id: number;
  email: string;
  ip: string | null;
  userAgent: string | null;
  status: string;
  createdAt: string;
}

interface Row {
  id: number;
  email: string;
  ip: string | null;
  user_agent: string | null;
  status: string;
  created_at: string;
}

function toRequest(row: Row): AccessRequest {
  return {
    id: row.id,
    email: row.email,
    ip: row.ip,
    userAgent: row.user_agent,
    status: row.status,
    createdAt: row.created_at,
  };
}

export interface NewAccessRequest {
  email: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export async function insert(db: D1Database, entry: NewAccessRequest): Promise<void> {
  await execute(
    db,
    "INSERT INTO access_requests (email, ip, user_agent, created_at) VALUES (?, ?, ?, ?)",
    [entry.email, entry.ip, entry.userAgent, entry.createdAt],
  );
}

export async function listByStatus(db: D1Database, status = "pending"): Promise<AccessRequest[]> {
  const rows = await queryAll<Row>(
    db,
    "SELECT * FROM access_requests WHERE status = ? ORDER BY id DESC",
    [status],
  );
  return rows.map(toRequest);
}

export async function getById(db: D1Database, id: number): Promise<AccessRequest | null> {
  const row = await queryOne<Row>(db, "SELECT * FROM access_requests WHERE id = ?", [id]);
  return row ? toRequest(row) : null;
}

export async function setStatus(db: D1Database, id: number, status: string): Promise<void> {
  await execute(db, "UPDATE access_requests SET status = ? WHERE id = ?", [status, id]);
}

/**
 * Resolves EVERY still-pending request for an email at once. Testers re-submit the public form when
 * no confirmation arrives (copy-paste mode sends none), so duplicates are the norm — handling only
 * the clicked row would leave stale siblings whose Invite button silently rotates a just-sent token.
 */
export async function setStatusByEmail(
  db: D1Database,
  email: string,
  status: string,
): Promise<void> {
  await execute(
    db,
    "UPDATE access_requests SET status = ? WHERE email = ? AND status = 'pending'",
    [status, email],
  );
}

export async function countPending(db: D1Database): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM access_requests WHERE status = 'pending'",
  );
  return row?.n ?? 0;
}
