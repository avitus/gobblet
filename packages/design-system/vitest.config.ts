import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["test/**/*.test.tsx", "test/**/*.test.ts"],
    environment: "jsdom",
    globals: false,
    setupFiles: ["test/setup.ts"],
    coverage: {
      enabled: false,
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
