import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  bundle: true,
  splitting: false,
  external: [
    "@soullink-emotion/engine",
    "@soullink-emotion/planner-openai"
  ],
  dts: true,
  sourcemap: true,
  clean: true
});
