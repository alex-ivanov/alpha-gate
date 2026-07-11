import type { AccessEvent } from "../core/types";
import { execute, queryAll, queryOne } from "./client";

// §5/§16 — the access log: the source of truth for distribution stats (download/update counts,
// per-user last activity, current version). `created_at` is supplied by the caller's Clock so
// time-dependent reads (stats, the §16 prune) are deterministic in tests.

export interface NewAccessEvent {
  clientId: number | null;
  email: string | null;
  event: AccessEvent;
  shortVersion?: string | null;
  buildNumber?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export async function insertEvent(db: D1Database, entry: NewAccessEvent): Promise<void> {
  await execute(
    db,
    `INSERT INTO access_log
       (client_id, email, event, short_version, build_number, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.clientId,
      entry.email,
      entry.event,
      entry.shortVersion ?? null,
      entry.buildNumber ?? null,
      entry.ip ?? null,
      entry.userAgent ?? null,
      entry.createdAt,
    ],
  );
}

/** Per-build count of a given event (e.g. downloads or updates of a build_number). */
export async function countByBuild(
  db: D1Database,
  buildNumber: number,
  event: AccessEvent,
): Promise<number> {
  const row = await queryOne<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM access_log WHERE build_number = ? AND event = ?",
    [buildNumber, event],
  );
  return row?.n ?? 0;
}

/** The most recent time a client produced a given event (per-user "last installed/updated/seen"). */
export async function lastEventAt(
  db: D1Database,
  clientId: number,
  event: AccessEvent,
): Promise<string | null> {
  const row = await queryOne<{ v: string | null }>(
    db,
    "SELECT MAX(created_at) AS v FROM access_log WHERE client_id = ? AND event = ?",
    [clientId, event],
  );
  return row?.v ?? null;
}

/** The most recent time a client produced ANY event — the Users list's "last seen". */
export async function lastSeenAt(db: D1Database, clientId: number): Promise<string | null> {
  const row = await queryOne<{ v: string | null }>(
    db,
    "SELECT MAX(created_at) AS v FROM access_log WHERE client_id = ?",
    [clientId],
  );
  return row?.v ?? null;
}

/** The build_number the client reported on its latest `check` — its current installed version. */
export async function currentBuild(db: D1Database, clientId: number): Promise<number | null> {
  const row = await queryOne<{ build_number: number | null }>(
    db,
    `SELECT build_number FROM access_log
     WHERE client_id = ? AND event = 'check' AND build_number IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [clientId],
  );
  return row?.build_number ?? null;
}

/** §16 retention prune: delete rows older than `before` (an ISO timestamp). */
export async function prune(db: D1Database, before: string): Promise<void> {
  await execute(db, "DELETE FROM access_log WHERE created_at < ?", [before]);
}

export interface AccessLogEntry {
  id: number;
  clientId: number | null;
  email: string | null;
  event: AccessEvent;
  shortVersion: string | null;
  buildNumber: number | null;
  createdAt: string;
}

export interface ActivityFilter {
  limit?: number;
  email?: string | undefined;
  event?: AccessEvent | undefined;
  buildNumber?: number | undefined;
}

/** The most recent events, newest first — the §13 activity feed; optionally filtered. */
export async function recent(
  db: D1Database,
  filter: ActivityFilter = {},
): Promise<AccessLogEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.email) {
    // Contains-match: "alice" should find alice@corner.studio (LIKE is case-insensitive for ASCII).
    where.push("email LIKE ?");
    params.push(`%${filter.email.replaceAll("%", "").replaceAll("_", "")}%`);
  }
  if (filter.event) {
    where.push("event = ?");
    params.push(filter.event);
  }
  if (filter.buildNumber !== undefined) {
    where.push("build_number = ?");
    params.push(filter.buildNumber);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await queryAll<{
    id: number;
    client_id: number | null;
    email: string | null;
    event: string;
    short_version: string | null;
    build_number: number | null;
    created_at: string;
  }>(
    db,
    `SELECT id, client_id, email, event, short_version, build_number, created_at
     FROM access_log ${clause} ORDER BY id DESC LIMIT ?`,
    [...params, filter.limit ?? 100],
  );
  return rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    email: row.email,
    event: row.event as AccessEvent,
    shortVersion: row.short_version,
    buildNumber: row.build_number,
    createdAt: row.created_at,
  }));
}

/** The most recent event time for a build (any event) — the §13 builds-list "last activity". */
export async function lastActivityForBuild(
  db: D1Database,
  buildNumber: number,
): Promise<string | null> {
  const row = await queryOne<{ v: string | null }>(
    db,
    "SELECT MAX(created_at) AS v FROM access_log WHERE build_number = ?",
    [buildNumber],
  );
  return row?.v ?? null;
}
