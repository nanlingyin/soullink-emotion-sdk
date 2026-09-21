import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import { createSoullinkAIPlugin } from "./scripts/ai-vite-plugin.mjs";
import { resolveDemoAssetLayout } from "./scripts/demo-assets.mjs";

const rootDir = resolve(import.meta.dirname);

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const assets = resolveDemoAssetLayout(rootDir, env.SOULLINK_DEMO_PUBLIC_DIR);
  const includeLocalAssets = command === "serve" || env.SOULLINK_INCLUDE_MODEL_ASSETS === "1";

  return {
    // Licensed model assets remain local by default. Set the explicit build
    // opt-in only when the deployment has permission to redistribute them.
    publicDir: includeLocalAssets && existsSync(assets.publicDir) ? assets.publicDir : false,
    define: {
      "globalThis.__SOULLINK_MODEL_BASE_URL__": JSON.stringify(assets.modelsBaseUrl)
    },
    plugins: [createSoullinkAIPlugin(rootDir, env)],
    server: {
      fs: {
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "api"]
      }
    }
  };
});
