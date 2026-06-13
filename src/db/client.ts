// The thin seam over the D1 binding: typed prepared-statement helpers with parameter binding and
// error normalization. NO ORM — every query module writes raw SQL and uses these three primitives.

export class DbError extends Error {
  constructor(
    readonly sql: string,
    cause: unknown,
  ) {
    super(`D1 query failed: ${sql}`, { cause });
    this.name = "DbError";
  }
}

/** First matching row, or null. */
export async function queryOne<T>(
  db: D1Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  try {
    return (
      (await db
        .prepare(sql)
        .bind(...params)
        .first<T>()) ?? null
    );
  } catch (cause) {
    throw new DbError(sql, cause);
  }
}

/** All matching rows. */
export async function queryAll<T>(
  db: D1Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  try {
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return results;
  } catch (cause) {
    throw new DbError(sql, cause);
  }
}

/** A statement run for its effect (INSERT/UPDATE/DELETE without a returned row). */
export async function execute(
  db: D1Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<void> {
  try {
    await db
      .prepare(sql)
      .bind(...params)
      .run();
  } catch (cause) {
    throw new DbError(sql, cause);
  }
}

/** Like execute, but returns the number of rows changed — for conditional/optimistic writes. */
export async function executeWithChanges(
  db: D1Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<number> {
  try {
    const result = await db
      .prepare(sql)
      .bind(...params)
      .run();
    return result.meta.changes ?? 0;
  } catch (cause) {
    throw new DbError(sql, cause);
  }
}
