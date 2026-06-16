import type { Client, ClientStatus } from "../core/types";
import { execute, queryAll, queryOne } from "./client";

// Raw prepared statements for the `clients` table. Returns plain Client domain objects (camelCase)
// for the pure core; maps the snake_case D1 row here so no other layer sees column names.

interface ClientRow {
  id: number;
  email: string;
  token: string;
  status: string;
  pinned_build_id: number | null;
  label: string | null;
  hidden: number;
  created_at: string;
  updated_at: string;
}

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    status: row.status as ClientStatus,
    pinnedBuildId: row.pinned_build_id,
    label: row.label,
    hidden: row.hidden !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewClient {
  email: string;
  token: string;
  label?: string | null;
}

/** Token lookup for the public gate — by the UNIQUE-indexed column so the DB does the comparison. */
export async function findByToken(db: D1Database, token: string): Promise<Client | null> {
  const row = await queryOne<ClientRow>(db, "SELECT * FROM clients WHERE token = ?", [token]);
  return row ? toClient(row) : null;
}

export async function getById(db: D1Database, id: number): Promise<Client | null> {
  const row = await queryOne<ClientRow>(db, "SELECT * FROM clients WHERE id = ?", [id]);
  return row ? toClient(row) : null;
}

export async function findByEmail(db: D1Database, email: string): Promise<Client | null> {
  const row = await queryOne<ClientRow>(db, "SELECT * FROM clients WHERE email = ?", [email]);
  return row ? toClient(row) : null;
}

export async function list(db: D1Database): Promise<Client[]> {
  const rows = await queryAll<ClientRow>(db, "SELECT * FROM clients ORDER BY id");
  return rows.map(toClient);
}

export async function insert(db: D1Database, input: NewClient): Promise<Client> {
  const row = await queryOne<ClientRow>(
    db,
    "INSERT INTO clients (email, token, label) VALUES (?, ?, ?) RETURNING *",
    [input.email, input.token, input.label ?? null],
  );
  if (row === null) throw new Error("INSERT clients returned no row");
  return toClient(row);
}

export async function setStatus(db: D1Database, id: number, status: ClientStatus): Promise<void> {
  await execute(db, "UPDATE clients SET status = ?, updated_at = datetime('now') WHERE id = ?", [
    status,
    id,
  ]);
}

/** Re-issue: replace the token (§12 journey 5). */
export async function setToken(db: D1Database, id: number, token: string): Promise<void> {
  await execute(db, "UPDATE clients SET token = ?, updated_at = datetime('now') WHERE id = ?", [
    token,
    id,
  ]);
}

/** Admin-list visibility (declutter only; does not affect resolution). */
export async function setHidden(db: D1Database, id: number, hidden: boolean): Promise<void> {
  await execute(db, "UPDATE clients SET hidden = ?, updated_at = datetime('now') WHERE id = ?", [
    hidden ? 1 : 0,
    id,
  ]);
}

export async function setPinnedBuild(
  db: D1Database,
  id: number,
  buildId: number | null,
): Promise<void> {
  await execute(
    db,
    "UPDATE clients SET pinned_build_id = ?, updated_at = datetime('now') WHERE id = ?",
    [buildId, id],
  );
}
