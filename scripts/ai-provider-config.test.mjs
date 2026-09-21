import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAIProviderConfig, publicAIProviderConfig } from "./ai-provider-config.mjs";

async function withConfigDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "soullink-provider-config-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("loads independent providers from .env without exposing their keys", async () => {
  await withConfigDirectory(async (rootDir) => {
    await writeFile(join(rootDir, ".env"), [
      "OPENAI_BASE_URL=https://llm.example/v1/",
      "OPENAI_API_KEY=openai-secret",
      "SOULLINK_LLM_MODEL=vendor/chat",
      "SOULLINK_EMBEDDING_MODEL=vendor/embedding",
      "RIVO_API_KEY=rivo-secret",
      "FISH_API_KEY=fish-secret",
      "FISH_REFERENCE_ID=voice-reference",
      "JEV_API_KEY=jev-secret",
      "JEV_MODEL=typesafe/jev-test",
      "SOULLINK_DEMO_PUBLIC_DIR=custom/demo-public"
    ].join("\n"));

    const config = loadAIProviderConfig({ rootDir, env: {} });
    assert.equal(config.apiKey, "openai-secret");
    assert.equal(config.baseURL, "https://llm.example/v1");
    assert.equal(config.llmModel, "vendor/chat");
    assert.equal(config.embeddingModel, "vendor/embedding");
    assert.equal(config.providers.rivo.apiKey, "rivo-secret");
    assert.equal(config.providers.fish.referenceId, "voice-reference");
    assert.equal(config.providers.jev.model, "typesafe/jev-test");
    assert.equal(config.demoPublicDir, "custom/demo-public");

    const publicConfig = JSON.stringify(publicAIProviderConfig(config));
    assert.equal(publicConfig.includes("openai-secret"), false);
    assert.equal(publicConfig.includes("rivo-secret"), false);
    assert.equal(publicConfig.includes("fish-secret"), false);
    assert.equal(publicConfig.includes("jev-secret"), false);
  });
});

test("runtime environment overrides the configured demo public directory", async () => {
  await withConfigDirectory(async (rootDir) => {
    const config = loadAIProviderConfig({
      rootDir,
      env: { SOULLINK_DEMO_PUBLIC_DIR: "environment/public" }
    });
    assert.equal(config.demoPublicDir, "environment/public");
  });
});

test("runtime environment overrides file values", async () => {
  await withConfigDirectory(async (rootDir) => {
    await writeFile(join(rootDir, ".env"), "JEV_MODEL=file-model\nJEV_API_KEY=file-key\n");
    const config = loadAIProviderConfig({
      rootDir,
      env: { JEV_MODEL: "environment-model", JEV_API_KEY: "environment-key" }
    });
    assert.equal(config.providers.jev.model, "environment-model");
    assert.equal(config.providers.jev.apiKey, "environment-key");
  });
});
