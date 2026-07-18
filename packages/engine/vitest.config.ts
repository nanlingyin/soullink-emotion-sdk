import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default {
  root,
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
};
