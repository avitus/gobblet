import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      enabled: false,
      provider: "v8",
      include: ["src/**/*.ts"],
      // types.ts declares types only, so it produces no runtime code to cover.
      exclude: ["src/types.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
