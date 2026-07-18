import { performance } from "node:perf_hooks";
import { EmbeddingMessageClassifier, QwenEmbeddingClient } from "@soullink-emotion/classifier-embedding";
import { SoullinkLLMPlanner, SoullinkSpeakingMotionPlanner } from "@soullink-emotion/planner-openai";
import { loadAIProviderConfig, publicAIProviderConfig } from "./ai-provider-config.mjs";

const config = loadAIProviderConfig();
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
  similarityThreshold: 0.61
});

const embeddingStartedAt = performance.now();
await classifier.initialize();
const embeddingIntent = await classifier.classify("终于把这个问题修好了，我现在特别开心");
const embeddingElapsedMs = Math.round(performance.now() - embeddingStartedAt);

const plannerStartedAt = performance.now();
const plan = await planner.plan({
  message: "我终于完成了这个很难的项目，陪我庆祝一下吧",
  characterName: "Blondegirl",
  characterProfile: "温和、自然、有表现力的 Live2D 角色",
  vad: { valence: 0, arousal: 0, dominance: 0 }
});
const plannerElapsedMs = Math.round(performance.now() - plannerStartedAt);

const speakingMotionStartedAt = performance.now();
const speakingMotion = await speakingMotionPlanner.plan({
  speechText: "我终于完成了这个很难的项目！（先开心地抬头，再轻轻歪头看向你）",
  userMessage: "陪我庆祝一下吧",
  characterName: "Blondegirl",
  characterProfile: "温和、自然、有表现力的 Live2D 角色",
  mode: "fixed-parallel",
  frameCount: 4,
  frameIntervalSec: 0.75,
  intent: plan.intent,
  vad: plan.vadTarget,
  availableParameters: {
    ParamAngleX: { name: "头部角度 X", min: -30, max: 30, default: 0 },
    ParamAngleY: { name: "头部角度 Y", min: -30, max: 30, default: 0 },
    ParamAngleZ: { name: "头部角度 Z", min: -30, max: 30, default: 0 },
    ParamBodyAngleX: { name: "身体角度 X", min: -10, max: 10, default: 0 },
    ParamBodyAngleY: { name: "身体角度 Y", min: -10, max: 10, default: 0 },
    ParamBodyAngleZ: { name: "身体角度 Z", min: -10, max: 10, default: 0 },
    ParamEyeBallX: { name: "视线 X", min: -1, max: 1, default: 0 },
    ParamEyeBallY: { name: "视线 Y", min: -1, max: 1, default: 0 },
    ParamEyeLSmile: { name: "左笑眼", min: 0, max: 1, default: 0 },
    ParamEyeRSmile: { name: "右笑眼", min: 0, max: 1, default: 0 },
    ParamMouthForm: { name: "嘴型", min: -1, max: 1, default: 0 },
    ParamCheek: { name: "脸颊泛红", min: 0, max: 1, default: 0 }
  }
});
const speakingMotionElapsedMs = Math.round(performance.now() - speakingMotionStartedAt);

if (!classifier.isInitialized) throw new Error("Embedding classifier did not initialize");
if (plan.provider !== "openai-compatible") {
  throw new Error(`LLM planner used ${plan.provider} instead of the configured provider`);
}
if (speakingMotion.provider !== "openai-compatible" || speakingMotion.parameterPlan.length !== 4) {
  throw new Error(
    `Speaking motion planner returned ${speakingMotion.provider} with ` +
    `${speakingMotion.parameterPlan.length}/4 frames: ${speakingMotion.debug?.fallbackReason ?? "unknown"}`
  );
}

console.log(JSON.stringify({
  config: publicAIProviderConfig(config),
  embedding: {
    initialized: classifier.isInitialized,
    exampleCount: classifier.exampleCount,
    elapsedMs: embeddingElapsedMs,
    intent: embeddingIntent
  },
  planner: {
    provider: plan.provider,
    elapsedMs: plannerElapsedMs,
    intent: plan.intent,
    replyDraft: plan.replyDraft,
    actionBeatCount: plan.actionPlan.length
  },
  speakingMotion: {
    provider: speakingMotion.provider,
    elapsedMs: speakingMotionElapsedMs,
    frameCount: speakingMotion.parameterPlan.length,
    frameIntervalSec: speakingMotion.debug?.frameIntervalSec,
    actionFrames: speakingMotion.motionPlan,
    parameterFrames: speakingMotion.parameterPlan.map((beat) => ({
      time: beat.time,
      duration: beat.duration,
      label: beat.label,
      parameters: beat.parameters
    }))
  }
}, null, 2));
