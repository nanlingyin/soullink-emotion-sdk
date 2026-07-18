import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  bundle: true,
  splitting: false,
  external: ["@soullink-emotion/engine"],
  dts: true,
  sourcemap: true,
  clean: true
});
