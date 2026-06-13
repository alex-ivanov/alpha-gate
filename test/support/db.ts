import { env } from "cloudflare:test";

// Tables in a delete-safe order — children before parents, because D1/Miniflare enforces foreign
// keys (so tests must also seed parent rows, e.g. a stream, before linking to it). Used in beforeEach
// to give each test a clean database, independent of whatever per-test storage isolation the pool provides.
const TABLES = [
  "build_streams",
  "user_streams",
  "access_log",
  "admin_audit",
  "clients",
  "builds",
  "streams",
  "meta",
];

export async function cleanDb(): Promise<void> {
  for (const table of TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}
