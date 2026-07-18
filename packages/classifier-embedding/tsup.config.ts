import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  bundle: true,
  splitting: false,
  external: ["@soullink-emotion/engine", "node:crypto", "node:fs/promises", "node:path"],
  dts: true,
  sourcemap: true,
  clean: true
});
