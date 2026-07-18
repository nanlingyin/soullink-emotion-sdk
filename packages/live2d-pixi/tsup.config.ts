import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/metadata.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "browser",
  bundle: true,
  splitting: false,
  external: [
    "@soullink-emotion/engine",
    "pixi.js",
    "pixi-live2d-display"
  ],
  dts: true,
  sourcemap: true,
  clean: true
});
