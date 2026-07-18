import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    internal: "src/internal.ts"
  },
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  bundle: true,
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true
});
