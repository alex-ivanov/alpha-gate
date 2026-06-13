import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

// Tests run inside the Workers runtime (workerd) via Miniflare — no real Cloudflare account, no
// network. Bindings are declared inline; the real §5 migrations are read here and applied per file
// in setup.ts, so the schema under test can never drift from production.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(repoRoot, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2025-01-01",
          d1Databases: ["DB"],
          r2Buckets: ["BUILDS"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Sensible defaults; integration/CUJ tests that care about ROLE build their own Deps.
            INSTANCE: "test",
            ROLE: "app",
            EMAIL_PROVIDER: "none",
            EMAIL_FROM: "",
            TOOL_VERSION: "0.0.0-test",
            UPDATE_MANIFEST_URL: "https://example.invalid/release.json",
          },
        },
      }),
    ],
    test: {
      include: [path.join(here, "**/*.test.{ts,tsx}")],
      setupFiles: [path.join(here, "setup.ts")],
    },
  };
});
