import type { Build, BuildStatus, BuildStreamLink } from "../core/types";
import { execute, queryAll, queryOne } from "./client";

// Raw prepared statements for `builds` and the `build_streams` join. Maps the INTEGER `critical`
// flag to boolean and the snake_case columns to the Build domain shape.

interface BuildRow {
  id: number;
  short_version: string;
  build_number: number;
  object_key: string;
  ed_signature: string;
  length: number;
  min_os: string | null;
  critical: number;
  status: string;
  dmg_object_key: string | null;
  dmg_length: number | null;
  created_at: string;
}

function toBuild(row: BuildRow): Build {
  return {
    id: row.id,
    shortVersion: row.short_version,
    buildNumber: row.build_number,
    objectKey: row.object_key,
    edSignature: row.ed_signature,
    length: row.length,
    minOs: row.min_os,
    critical: row.critical !== 0,
    status: row.status as BuildStatus,
    dmgObjectKey: row.dmg_object_key,
    dmgLength: row.dmg_length,
    createdAt: row.created_at,
  };
}

export interface NewBuild {
  shortVersion: string;
  buildNumber: number;
  objectKey: string;
  edSignature: string;
  length: number;
  minOs?: string | null;
  critical?: boolean;
  dmgObjectKey?: string | null;
  dmgLength?: number | null;
}

export async function getById(db: D1Database, id: number): Promise<Build | null> {
  const row = await queryOne<BuildRow>(db, "SELECT * FROM builds WHERE id = ?", [id]);
  return row ? toBuild(row) : null;
}

export async function getByBuildNumber(db: D1Database, buildNumber: number): Promise<Build | null> {
  const row = await queryOne<BuildRow>(db, "SELECT * FROM builds WHERE build_number = ?", [
    buildNumber,
  ]);
  return row ? toBuild(row) : null;
}

export async function listAll(db: D1Database): Promise<Build[]> {
  const rows = await queryAll<BuildRow>(db, "SELECT * FROM builds ORDER BY build_number");
  return rows.map(toBuild);
}

export async function listAvailable(db: D1Database): Promise<Build[]> {
  const rows = await queryAll<BuildRow>(
    db,
    "SELECT * FROM builds WHERE status = 'available' ORDER BY build_number",
  );
  return rows.map(toBuild);
}

export async function insert(db: D1Database, input: NewBuild): Promise<Build> {
  const row = await queryOne<BuildRow>(
    db,
    `INSERT INTO builds
       (short_version, build_number, object_key, ed_signature, length, min_os, critical, dmg_object_key, dmg_length)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      input.shortVersion,
      input.buildNumber,
      input.objectKey,
      input.edSignature,
      input.length,
      input.minOs ?? null,
      input.critical ? 1 : 0,
      input.dmgObjectKey ?? null,
      input.dmgLength ?? null,
    ],
  );
  if (row === null) throw new Error("INSERT builds returned no row");
  return toBuild(row);
}

export async function setStatus(db: D1Database, id: number, status: BuildStatus): Promise<void> {
  await execute(db, "UPDATE builds SET status = ? WHERE id = ?", [status, id]);
}

export async function setCritical(db: D1Database, id: number, critical: boolean): Promise<void> {
  await execute(db, "UPDATE builds SET critical = ? WHERE id = ?", [critical ? 1 : 0, id]);
}

export async function linkStream(db: D1Database, buildId: number, streamId: number): Promise<void> {
  await execute(db, "INSERT OR IGNORE INTO build_streams (build_id, stream_id) VALUES (?, ?)", [
    buildId,
    streamId,
  ]);
}

export async function unlinkStream(
  db: D1Database,
  buildId: number,
  streamId: number,
): Promise<void> {
  await execute(db, "DELETE FROM build_streams WHERE build_id = ? AND stream_id = ?", [
    buildId,
    streamId,
  ]);
}

/** All build→stream links (the resolver/no-build World input). */
export async function listBuildStreams(db: D1Database): Promise<BuildStreamLink[]> {
  const rows = await queryAll<{ build_id: number; stream_id: number }>(
    db,
    "SELECT build_id, stream_id FROM build_streams",
  );
  return rows.map((row) => ({ buildId: row.build_id, streamId: row.stream_id }));
}
