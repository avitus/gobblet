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
      // The process entry point only reads configuration, installs signal
      // handlers and listens; everything it wires up is covered through
      // src/bootstrap.ts.
      exclude: ["src/main.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
