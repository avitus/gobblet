import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Match runtime suites share one PostgreSQL database and truncate between
    // tests, so files must not run in parallel.
    fileParallelism: false,
    coverage: {
      enabled: false,
      provider: "v8",
      include: ["src/**/*.ts"],
      // The process entry points only read configuration, install signal handlers
      // and listen; everything they wire up is covered through src/bootstrap.ts and
      // src/admin/grant.ts.
      exclude: ["src/main.ts", "src/cli/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
