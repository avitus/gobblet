import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "node",
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
});
