import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { API_URL, SERVER_ENV, WEB_HOST, WEB_PORT, WEB_URL } from "./setup/environment";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const isCi = process.env.CI === "true" || process.env.CI === "1";

/**
 * Browser proof of the Phase 5 exit criteria (docs/adr/0021). The suite runs the
 * production client build against a real server and a real database, in Chromium
 * and WebKit: the two engines the desktop shells will use.
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: isCi ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: [
        "pnpm turbo run build --filter=@gobblet/server",
        "pnpm --filter @gobblet/e2e exec tsx setup/prepare-database.ts",
        "node apps/server/dist/main.js",
      ].join(" && "),
      cwd: repositoryRoot,
      url: `${API_URL}/health/ready`,
      env: SERVER_ENV,
      reuseExistingServer: !isCi,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // The bundle carries the API address, so the build belongs to the suite.
      command: [
        "pnpm turbo run build --filter=@gobblet/web",
        // The address is explicit: a host name can resolve to an interface the suite
        // is not watching, which is how this first failed in continuous integration.
        `pnpm --filter @gobblet/web exec vite preview --host ${WEB_HOST} --port ${String(WEB_PORT)} --strictPort`,
      ].join(" && "),
      cwd: repositoryRoot,
      url: WEB_URL,
      env: {
        VITE_API_BASE_URL: API_URL,
        VITE_SOCKET_URL: API_URL,
        VITE_APP_ENV: "local",
        VITE_CLIENT_VERSION: "0.1.0",
      },
      reuseExistingServer: !isCi,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
