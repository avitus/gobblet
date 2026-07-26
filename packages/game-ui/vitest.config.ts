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
      // The WebGL scene needs a real graphics context, so it is proved by the
      // Playwright suite in a browser instead (docs/adr/0021). Everything the
      // scene decides lives in `scene/description.ts`, which is covered here.
      exclude: ["src/scene/BoardScene.tsx", "src/scene/Pieces.tsx"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
