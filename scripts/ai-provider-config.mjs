import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_LLM_MODEL = "deepseek-ai/DeepSeek-V3.2";
const DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B";

export function loadAIProviderConfig(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const environment = options.env ?? process.env;
  const configPath = resolve(rootDir, options.configFile ?? "api");
  const lines = (existsSync(configPath) ? readFileSync(configPath, "utf8") : "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const entries = mergeNonEmpty(
    parseKeyValueLines(lines),
    readKeyValueFile(resolve(rootDir, ".env")),
    readKeyValueFile(resolve(rootDir, ".env.local"))
  );
  const apiKey = environment.OPENAI_API_KEY || entries.OPENAI_API_KEY || (lines[0]?.includes("=") ? "" : lines[0]) || "";
  const baseURLIndex = lines.findIndex((line, index) => index > 0 && /^https?:\/\//iu.test(line));
  const baseURL = (environment.OPENAI_BASE_URL || entries.OPENAI_BASE_URL)?.replace(/\/+$/u, "")
    || (baseURLIndex >= 0 ? lines[baseURLIndex].replace(/\/+$/u, "") : "");
  const models = lines
    .slice(Math.max(baseURLIndex + 1, 2))
    .map((line) => line.replace(/^[-*]\s*/u, ""))
    .filter((line) => /^[\w.-]+\/[\w./-]+$/u.test(line));

  const providers = {
    rivo: {
      apiKey: environment.RIVO_API_KEY || entries.RIVO_API_KEY || apiKey,
      baseURL: (environment.RIVO_BASE_URL || entries.RIVO_BASE_URL || baseURL || "https://rivoapi.com/v1").replace(/\/+$/u, ""),
      model: environment.RIVO_MODEL || entries.RIVO_MODEL || "gemini-3-flash-preview"
    },
    fish: {
      apiKey: environment.FISH_API_KEY || entries.FISH_API_KEY || "",
      baseURL: (environment.FISH_BASE_URL || entries.FISH_BASE_URL || "https://api.fish.audio/v1").replace(/\/+$/u, ""),
      referenceId: environment.FISH_REFERENCE_ID || entries.FISH_REFERENCE_ID || "",
      model: environment.FISH_MODEL || entries.FISH_MODEL || "s2.1-pro"
    },
    jev: {
      apiKey: environment.JEV_API_KEY || environment.OPENROUTER_API_KEY || entries.JEV_API_KEY || "",
      baseURL: (environment.JEV_BASE_URL || entries.JEV_BASE_URL || "https://openrouter.ai/api/alpha").replace(/\/+$/u, ""),
      model: environment.JEV_MODEL || entries.JEV_MODEL || "~typesafe/jev-latest"
    }
  };

  const llmModel = selectModel(
    environment.SOULLINK_LLM_MODEL || entries.SOULLINK_LLM_MODEL || entries.OPENAI_MODEL,
    models,
    DEFAULT_LLM_MODEL,
    (model) => !/(embedding|reranker|image|i2v|t2v|tts|cosyvoice)/iu.test(model)
  );
  const embeddingModel = selectModel(
    environment.SOULLINK_EMBEDDING_MODEL || entries.SOULLINK_EMBEDDING_MODEL,
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
    providers,
    configPath
  };
}

export function publicAIProviderConfig(config) {
  return {
    configured: Boolean(config.apiKey && config.baseURL),
    baseURL: config.baseURL,
    llmModel: config.llmModel,
    embeddingModel: config.embeddingModel,
    conversation: { configured: Boolean(config.providers?.rivo?.apiKey), model: config.providers?.rivo?.model },
    voice: { configured: Boolean(config.providers?.fish?.apiKey), referenceId: Boolean(config.providers?.fish?.referenceId), model: config.providers?.fish?.model },
    jev: { configured: Boolean(config.providers?.jev?.apiKey), model: config.providers?.jev?.model }
  };
}

function selectModel(explicit, models, preferred, predicate) {
  if (explicit?.trim()) return explicit.trim();
  if (models.includes(preferred)) return preferred;
  return models.find(predicate) ?? preferred;
}

function readKeyValueFile(path) {
  if (!existsSync(path)) return {};
  return parseKeyValueLines(readFileSync(path, "utf8").split(/\r?\n/u));
}

function parseKeyValueLines(lines) {
  const entries = {};
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^export\s+/u, "");
    if (!line || line.startsWith("#") || !line.includes("=") || line.startsWith("http")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function mergeNonEmpty(...sources) {
  const result = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value) result[key] = value;
    }
  }
  return result;
}
