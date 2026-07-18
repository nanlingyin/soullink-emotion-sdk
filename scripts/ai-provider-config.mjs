import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_LLM_MODEL = "deepseek-ai/DeepSeek-V3.2";
const DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B";

export function loadAIProviderConfig(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const configPath = resolve(rootDir, options.configFile ?? "api");
  const lines = readFileSync(configPath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const apiKey = lines[0] ?? "";
  const baseURLIndex = lines.findIndex((line, index) => index > 0 && /^https?:\/\//iu.test(line));
  const baseURL = baseURLIndex >= 0 ? lines[baseURLIndex].replace(/\/+$/u, "") : "";
  const models = lines
    .slice(Math.max(baseURLIndex + 1, 2))
    .map((line) => line.replace(/^[-*]\s*/u, ""))
    .filter((line) => /^[\w.-]+\/[\w./-]+$/u.test(line));

  if (!apiKey || !baseURL) {
    throw new Error("api 配置至少需要第一行 API key 和一行 OpenAI 兼容 baseURL");
  }

  const llmModel = selectModel(
    process.env.SOULLINK_LLM_MODEL,
    models,
    DEFAULT_LLM_MODEL,
    (model) => !/(embedding|reranker|image|i2v|t2v|tts|cosyvoice)/iu.test(model)
  );
  const embeddingModel = selectModel(
    process.env.SOULLINK_EMBEDDING_MODEL,
    models,
    DEFAULT_EMBEDDING_MODEL,
    (model) => /embedding/iu.test(model)
  );

  return {
    apiKey,
    baseURL,
    llmModel,
    embeddingModel,
    availableModels: models,
    configPath
  };
}

export function publicAIProviderConfig(config) {
  return {
    configured: Boolean(config.apiKey && config.baseURL),
    baseURL: config.baseURL,
    llmModel: config.llmModel,
    embeddingModel: config.embeddingModel
  };
}

function selectModel(explicit, models, preferred, predicate) {
  if (explicit?.trim()) return explicit.trim();
  if (models.includes(preferred)) return preferred;
  return models.find(predicate) ?? preferred;
}
