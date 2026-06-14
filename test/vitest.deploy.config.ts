import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The deploy CLI (src/deploy) is plain Node code that shells out to wrangler, so its tests run in a
// Node environment — NOT the workerd/Miniflare pool the app suite uses (test/vitest.config.ts).
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: [path.join(here, "deploy/**/*.test.ts")],
    environment: "node",
  },
});
