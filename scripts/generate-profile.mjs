import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Live2DProfileAutoGenerator } from "@soullink-emotion/profile-generator";
import { modelCatalog } from "../src/model-catalog.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const modelOptionIndex = process.argv.indexOf("--model");
const requestedModel = modelOptionIndex >= 0 ? process.argv[modelOptionIndex + 1] : undefined;
const targets = requestedModel
  ? modelCatalog.filter((model) => model.id === requestedModel || model.modelDir === requestedModel)
  : modelCatalog;

if (requestedModel && targets.length === 0) {
  throw new Error(`Unknown model "${requestedModel}". Expected: ${modelCatalog.map((model) => model.id).join(", ")}`);
}

const generator = new Live2DProfileAutoGenerator({
  modelsRoot: resolve(root, "l2d"),
  modelsBaseUrl: "/l2d",
  defaultModelDir: modelCatalog[0].modelDir,
  useConfiguredOpenAI: false
});

const results = [];
for (const model of targets) {
  const result = await generator.ensure({
    modelDir: model.modelDir,
    displayName: model.displayName,
    force
  });
  if (model.profileOverrides) {
    const generatedProfile = result.profile;
    const saveResult = await generator.saveCalibratedProfile({
      modelDir: model.modelDir,
      displayName: model.displayName,
      parameterMap: model.profileOverrides.parameterMap,
      privateEmotionMap: model.profileOverrides.privateEmotionMap
    });
    result.profile = {
      ...saveResult.profile,
      nativeAnimations: generatedProfile.nativeAnimations,
      expressionMap: model.profileOverrides.expressionMap ?? generatedProfile.expressionMap,
      motionMap: generatedProfile.motionMap
    };
    result.provider = saveResult.provider;
    result.notes = [...result.notes, "Applied project model profile overrides"];
    await writeFile(
      resolve(root, "l2d", model.modelDir, "soullink.profile.json"),
      `${JSON.stringify(result.profile, null, 2)}\n`,
      "utf8"
    );
  }
  results.push({
    id: model.id,
    generated: result.generated,
    reason: result.reason,
    provider: result.provider,
    profileUrl: result.profileUrl,
    modelUrl: result.modelUrl,
    mappedFACS: Object.keys(result.profile.parameterMap).length,
    privateEmotions: Object.keys(result.profile.privateEmotionMap ?? {}).length,
    expressions: result.profile.nativeAnimations?.expressions?.length ?? 0,
    motions: result.profile.nativeAnimations?.motions?.length ?? 0,
    notes: result.notes
  });
}

console.log(
  JSON.stringify(
    { models: results },
    null,
    2
  )
);
