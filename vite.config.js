import { resolve } from "node:path";
import { defineConfig } from "vite";
import { createSoullinkAIPlugin } from "./scripts/ai-vite-plugin.mjs";

const rootDir = resolve(import.meta.dirname);

export default defineConfig({
  plugins: [createSoullinkAIPlugin(rootDir)],
  server: {
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "api"]
    }
  }
});
