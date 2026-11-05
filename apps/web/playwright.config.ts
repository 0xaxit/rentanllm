import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3100;
const API_PORT = 8799;
const isCi = Boolean(process.env.CI);

/**
 * Smoke tests against the production build (`bun run build` first). The
 * config starts a stub API (Server Components fetch from it) and `next start`
 * pointed at it. Chromium only.
 */
export default defineConfig({
  forbidOnly: isCi,
  fullyParallel: true,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: isCi ? [["github"], ["html", { open: "never" }]] : "list",
  retries: isCi ? 1 : 0,
  testDir: "./e2e",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun e2e/stub-api.ts",
      env: { E2E_API_PORT: String(API_PORT) },
      reuseExistingServer: !isCi,
      url: `http://127.0.0.1:${API_PORT}/health`,
    },
    {
      command: `bun run start --port ${WEB_PORT} --hostname 127.0.0.1`,
      env: { API_ORIGIN: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !isCi,
      timeout: 60_000,
      url: `http://127.0.0.1:${WEB_PORT}`,
    },
  ],
});
