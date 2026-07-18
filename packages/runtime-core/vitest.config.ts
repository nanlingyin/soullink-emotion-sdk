import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "../..");

export default {
  root,
  resolve: {
    alias: {
      "@soullink-emotion/engine/internal": resolve(repoRoot, "packages/engine/src/internal.ts"),
      "@soullink-emotion/engine": resolve(repoRoot, "packages/engine/src/index.ts"),
    },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
};
