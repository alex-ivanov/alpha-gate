import type { Stream, UserStreamLink } from "../core/types";
import { execute, queryAll, queryOne } from "./client";

// Raw prepared statements for `streams` and the `user_streams` join (release channels and the
// per-user assignments the resolver reads).

interface StreamRow {
  id: number;
  name: string;
}

function toStream(row: StreamRow): Stream {
  return { id: row.id, name: row.name };
}

export async function create(db: D1Database, name: string): Promise<Stream> {
  const row = await queryOne<StreamRow>(db, "INSERT INTO streams (name) VALUES (?) RETURNING *", [
    name,
  ]);
  if (row === null) throw new Error("INSERT streams returned no row");
  return toStream(row);
}

export async function deleteById(db: D1Database, id: number): Promise<void> {
  await execute(db, "DELETE FROM streams WHERE id = ?", [id]);
}

/** Deletes a channel and its links first (FK-safe): build_streams + user_streams, then the row. */
export async function remove(db: D1Database, id: number): Promise<void> {
  await execute(db, "DELETE FROM build_streams WHERE stream_id = ?", [id]);
  await execute(db, "DELETE FROM user_streams WHERE stream_id = ?", [id]);
  await execute(db, "DELETE FROM streams WHERE id = ?", [id]);
}

export async function list(db: D1Database): Promise<Stream[]> {
  const rows = await queryAll<StreamRow>(db, "SELECT * FROM streams ORDER BY id");
  return rows.map(toStream);
}

export async function getByName(db: D1Database, name: string): Promise<Stream | null> {
  const row = await queryOne<StreamRow>(db, "SELECT * FROM streams WHERE name = ?", [name]);
  return row ? toStream(row) : null;
}

export async function getById(db: D1Database, id: number): Promise<Stream | null> {
  const row = await queryOne<StreamRow>(db, "SELECT * FROM streams WHERE id = ?", [id]);
  return row ? toStream(row) : null;
}

export async function assignUser(
  db: D1Database,
  clientId: number,
  streamId: number,
): Promise<void> {
  await execute(db, "INSERT OR IGNORE INTO user_streams (client_id, stream_id) VALUES (?, ?)", [
    clientId,
    streamId,
  ]);
}

export async function unassignUser(
  db: D1Database,
  clientId: number,
  streamId: number,
): Promise<void> {
  await execute(db, "DELETE FROM user_streams WHERE client_id = ? AND stream_id = ?", [
    clientId,
    streamId,
  ]);
}

/** All user→stream links (the resolver/no-build World input). */
export async function listUserStreams(db: D1Database): Promise<UserStreamLink[]> {
  const rows = await queryAll<{ client_id: number; stream_id: number }>(
    db,
    "SELECT client_id, stream_id FROM user_streams",
  );
  return rows.map((row) => ({ clientId: row.client_id, streamId: row.stream_id }));
}

/** The stream ids one client is assigned to — the slice /appcast needs for a single token. */
export async function streamIdsForClient(db: D1Database, clientId: number): Promise<number[]> {
  const rows = await queryAll<{ stream_id: number }>(
    db,
    "SELECT stream_id FROM user_streams WHERE client_id = ?",
    [clientId],
  );
  return rows.map((row) => row.stream_id);
}
