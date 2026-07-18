import { resolve } from "node:path";
import { EmbeddingMessageClassifier, QwenEmbeddingClient } from "@soullink-emotion/classifier-embedding";
import { FileEmbeddingVectorCache } from "@soullink-emotion/classifier-embedding/node";
import { SoullinkLLMPlanner, SoullinkSpeakingMotionPlanner } from "@soullink-emotion/planner-openai";
import { loadAIProviderConfig, publicAIProviderConfig } from "./ai-provider-config.mjs";

const MAX_BODY_BYTES = 64 * 1024;

export function createSoullinkAIPlugin(rootDir) {
  return {
    name: "soullink-ai-test-api",
    configureServer(server) {
      const config = loadAIProviderConfig({ rootDir });
      const planner = new SoullinkLLMPlanner({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.llmModel,
        timeoutMs: 120_000
      });
      const speakingMotionPlanner = new SoullinkSpeakingMotionPlanner({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.llmModel,
        timeoutMs: 120_000
      }, {
        mode: "fixed-parallel",
        fixedFrameCount: 4,
        frameIntervalSec: 0.75,
        minFrameCount: 2,
        maxFrameCount: 12,
        twoStage: true
      });
      const embeddingProvider = new QwenEmbeddingClient({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.embeddingModel,
        timeoutMs: 120_000
      });
      const classifier = new EmbeddingMessageClassifier(embeddingProvider, {
        similarityThreshold: 0.61,
        embeddingCache: new FileEmbeddingVectorCache({
          directory: resolve(rootDir, "output", "cache", "embeddings")
        })
      });
      let embeddingInitialization;

      const ensureEmbeddingInitialized = async () => {
        if (!embeddingInitialization) {
          embeddingInitialization = classifier.initialize().catch((error) => {
            embeddingInitialization = undefined;
            throw error;
          });
        }
        await embeddingInitialization;
      };

      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        if (isProviderConfigRequest(pathname, config.configPath)) {
          sendJSON(response, 403, { error: "Provider configuration is server-only" });
          return;
        }
        if (pathname !== "/api" && !pathname.startsWith("/api/")) {
          next();
          return;
        }

        try {
          if (request.method === "GET" && (pathname === "/api" || pathname === "/api/health")) {
            sendJSON(response, 200, {
              ok: true,
              service: "soullink-local-ai-test",
              ...publicAIProviderConfig(config)
            });
            return;
          }

          if (request.method === "GET" && pathname === "/api/llm/config") {
            sendJSON(response, 200, {
              configured: planner.config.configured,
              baseURL: planner.config.baseURL,
              model: planner.config.model,
              timeoutMs: planner.config.timeoutMs
            });
            return;
          }

          if (request.method === "GET" && pathname === "/api/embedding/config") {
            sendJSON(response, 200, {
              ...embeddingProvider.config,
              classifierInitialized: classifier.isInitialized,
              exampleCount: classifier.exampleCount
            });
            return;
          }

          if (request.method === "GET" && pathname === "/api/llm/speaking-motion/config") {
            sendJSON(response, 200, {
              configured: speakingMotionPlanner.config.openAI.configured,
              baseURL: speakingMotionPlanner.config.openAI.baseURL,
              model: speakingMotionPlanner.config.openAI.model,
              timeoutMs: speakingMotionPlanner.config.openAI.timeoutMs,
              ...speakingMotionPlanner.config.generation
            });
            return;
          }

          if (request.method === "POST" && pathname === "/api/reaction/classify-embedding") {
            const body = await readJSONBody(request);
            const message = typeof body.message === "string" ? body.message.trim() : "";
            if (!message) {
              sendJSON(response, 400, { error: "message is required" });
              return;
            }
            await ensureEmbeddingInitialized();
            const intent = await classifier.classify(message);
            sendJSON(response, 200, {
              intent,
              initialized: classifier.isInitialized,
              exampleCount: classifier.exampleCount
            });
            return;
          }

          if (request.method === "POST" && pathname === "/api/llm/reaction/plan") {
            const body = await readJSONBody(request);
            const message = typeof body.message === "string" ? body.message.trim() : "";
            if (!message) {
              sendJSON(response, 400, { error: "message is required" });
              return;
            }
            const plan = await planner.plan({
              message,
              conversation: Array.isArray(body.conversation) ? body.conversation : undefined,
              characterName: typeof body.characterName === "string" ? body.characterName : "Blondegirl",
              characterProfile: typeof body.characterProfile === "string" ? body.characterProfile : undefined,
              vad: isObject(body.vad) ? body.vad : undefined,
              model: config.llmModel,
              temperature: typeof body.temperature === "number" ? body.temperature : 0.35
            });
            sendJSON(response, 200, plan);
            return;
          }

          if (request.method === "POST" && pathname === "/api/llm/speaking-motion/plan") {
            const body = await readJSONBody(request);
            const speechText = typeof body.speechText === "string" ? body.speechText.trim() : "";
            if (!speechText) {
              sendJSON(response, 400, { error: "speechText is required" });
              return;
            }
            const plan = await speakingMotionPlanner.plan({
              speechText,
              durationSec: finiteNumber(body.durationSec),
              mode: body.mode === "duration" ? "duration" : "fixed-parallel",
              frameCount: finiteNumber(body.frameCount),
              frameIntervalSec: finiteNumber(body.frameIntervalSec),
              availableParameters: isObject(body.availableParameters) ? body.availableParameters : undefined,
              intent: isObject(body.intent) ? body.intent : undefined,
              vad: isObject(body.vad) ? body.vad : undefined,
              expression: isObject(body.expression) ? body.expression : null,
              characterName: typeof body.characterName === "string" ? body.characterName : "Blondegirl",
              characterProfile: typeof body.characterProfile === "string" ? body.characterProfile : undefined,
              userMessage: typeof body.userMessage === "string" ? body.userMessage : undefined,
              model: config.llmModel,
              temperature: typeof body.temperature === "number" ? body.temperature : undefined
            });
            sendJSON(response, 200, plan);
            return;
          }

          sendJSON(response, 404, { error: `Unknown local AI test endpoint: ${pathname}` });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[Soullink AI test API] ${request.method} ${pathname}: ${message}`);
          sendJSON(response, 502, { error: message });
        }
      });
    }
  };
}

function readJSONBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJSON(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isProviderConfigRequest(pathname, configPath) {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const prefix = "/@fs/";
  if (!decodedPath.toLowerCase().startsWith(prefix)) return false;
  const requestedPath = decodedPath.slice(prefix.length).replace(/\\/gu, "/").toLowerCase();
  const protectedPath = configPath.replace(/\\/gu, "/").toLowerCase();
  return requestedPath === protectedPath;
}
