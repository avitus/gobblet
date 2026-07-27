import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Every suite shares one PostgreSQL database and truncates between tests,
    // so files must not run in parallel.
    fileParallelism: false,
    coverage: {
      enabled: false,
      provider: "v8",
      include: ["src/**/*.ts"],
      // `executor.ts` declares type aliases only, so it emits no runtime code to cover.
      exclude: ["src/cli/**", "src/executor.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
