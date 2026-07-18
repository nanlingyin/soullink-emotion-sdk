import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/browser.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  bundle: true,
  splitting: false,
  external: [
    "@soullink-emotion/engine",
    "@soullink-emotion/runtime-core"
  ],
  dts: true,
  sourcemap: true,
  clean: true
});
