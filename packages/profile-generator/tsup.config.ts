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
  // Resolve declarations from peer packages while keeping their runtime
  // modules external. This makes workspace and published builds agree.
  dts: { resolve: true },
  sourcemap: true,
  clean: true
});
