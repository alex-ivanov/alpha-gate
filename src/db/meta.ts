import { execute, queryAll, queryOne } from "./client";

// §22/§13 — the meta key-value table: branding text, the email template, and self-update bookkeeping.

export async function get(db: D1Database, key: string): Promise<string | null> {
  const row = await queryOne<{ value: string | null }>(db, "SELECT value FROM meta WHERE key = ?", [
    key,
  ]);
  return row?.value ?? null;
}

export async function set(db: D1Database, key: string, value: string): Promise<void> {
  await execute(
    db,
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function getAll(db: D1Database): Promise<Record<string, string>> {
  const rows = await queryAll<{ key: string; value: string | null }>(
    db,
    "SELECT key, value FROM meta",
  );
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.value !== null) out[row.key] = row.value;
  }
  return out;
}
