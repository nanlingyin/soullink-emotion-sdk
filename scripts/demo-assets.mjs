import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveDemoAssetLayout(rootDir, configuredPublicDir = "apps/web/public") {
  const publicDir = resolve(rootDir, configuredPublicDir);
  const publicModelsRoot = resolve(publicDir, "models");
  const legacyModelsRoot = resolve(rootDir, "l2d");
  const usePublicModels = existsSync(publicModelsRoot);

  return {
    publicDir,
    modelsRoot: usePublicModels ? publicModelsRoot : legacyModelsRoot,
    modelsBaseUrl: usePublicModels ? "/models" : "/l2d",
    usePublicModels
  };
}
