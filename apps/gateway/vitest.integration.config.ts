import { defineConfig } from "vitest/config";

/** Integration tests against Docker Postgres + Redis (see test/integration/setup.ts). */
export default defineConfig({
  test: {
    env: { GATEWAY_INTEGRATION: "1" },
    fileParallelism: false,
    globalSetup: ["test/integration/setup.ts"],
    hookTimeout: 180_000,
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
