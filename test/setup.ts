import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Apply the real §5 migrations to each test file's isolated D1 before its tests run.
// applyD1Migrations only runs un-applied migrations and records state in `d1_migrations`.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
