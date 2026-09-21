import "./style.css";
import { createConversationController, refreshConversationIcons } from "./conversation-controller.js";
import { validateReplay, sampleReplay } from "./parameter-replay.js";
import { createSoullinkApiClient } from "@soullink-emotion/api-client";
import {
  detectCapabilities,
  emotionVADPresets,
  getVADPreset,
  motionStylePresets,
  SoullinkRuntime
} from "@soullink-emotion/engine";
import { Live2DRenderer, createScriptTagCubismLoader } from "@soullink-emotion/live2d-pixi";
import { findModel, modelAssetUrl, modelCatalog } from "./model-catalog.js";

const modelQuery = new URLSearchParams(window.location.search).get("model");
const activeModel = findModel(modelQuery);
const modelUrl = modelAssetUrl(activeModel, activeModel.modelFile);
const profileUrl = modelAssetUrl(activeModel, "soullink.profile.json");
const coreUrl = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const aiClient = createSoullinkApiClient({
  baseURL: `${window.location.origin}/api`,
  timeouts: { llm: 120_000, embedding: 120_000 }
});

const reactionModeLabels = {
  local: "触发本地反应",
  embedding: "运行 Embedding 分类",
  llm: "运行 LLM 规划"
};

const emotionLabels = {
  neutral: "中性",
  calm: "平静",
  happy: "开心",
  excited: "兴奋",
  shy: "害羞",
  affectionate: "亲昵",
  curious: "好奇",
  confused: "困惑",
  tired: "疲惫",
  sad: "难过",
  anxiety: "焦虑",
  anger: "愤怒",
  angry: "恼怒",
  concerned: "关切",
  surprised: "惊讶"
};

const emotionVariants = {
  neutral: "neutral_ack",
  calm: "soft_calm",
  happy: "bright_smile",
  excited: "sparkle",
  shy: "bashful",
  affectionate: "warm",
  curious: "tilt",
  confused: "confused",
  tired: "drained",
  sad: "downcast",
  anxiety: "nervous",
  anger: "firm",
  angry: "annoyed",
  concerned: "soft_concern",
  surprised: "startled"
};

const facsGroups = [
  {
    label: "眉部",
    controls: [
      ["browInnerUp", "内眉上扬"],
      ["browOuterUp", "外眉上扬"],
      ["browDown", "眉毛下压"]
    ]
  },
  {
    label: "眼部",
    open: true,
    controls: [
      ["eyeOpen", "睁眼", 0, 1.25, 1],
      ["eyeSmile", "笑眼"],
      ["eyeSquint", "眯眼"],
      ["eyeBlinkL", "左眨眼"],
      ["eyeBlinkR", "右眨眼"]
    ]
  },
  {
    label: "嘴部",
    open: true,
    controls: [
      ["mouthSmile", "微笑", 0, 1, 0.04],
      ["mouthFrown", "嘴角下压"],
      ["mouthOpen", "张嘴"],
      ["mouthPucker", "嘟嘴"]
    ]
  },
  {
    label: "视线与头部",
    controls: [
      ["gazeX", "视线 X", -1, 1],
      ["gazeY", "视线 Y", -1, 1],
      ["headX", "头部 X", -1, 1],
      ["headY", "头部 Y", -1, 1],
      ["headZ", "头部 Z", -1, 1]
    ]
  },
  {
    label: "身体",
    controls: [
      ["bodyX", "身体 X", -1, 1],
      ["bodyY", "身体 Y", -1, 1],
      ["bodyZ", "身体 Z", -1, 1]
    ]
  },
  {
    label: "效果",
    controls: [
      ["blush", "脸红"],
      ["tear", "眼泪"],
      ["sweat", "汗滴"],
      ["breath", "呼吸", 0, 1, 0.5]
    ]
  }
];

const fallbackProfile = {
  modelId: activeModel.id,
  displayName: activeModel.displayName,
  version: "1.0.0",
  schemaVersion: 2,
  modelPath: modelUrl,
  parameterMap: {
    headX: { target: "ParamAngleX", mode: "set", scale: 30, min: -30, max: 30 },
    headY: { target: "ParamAngleY", mode: "set", scale: 30, min: -30, max: 30 },
    headZ: { target: "ParamAngleZ", mode: "set", scale: 30, min: -30, max: 30 },
    bodyX: { target: "ParamBodyAngleX", mode: "set", scale: 10, min: -10, max: 10 },
    bodyY: { target: "ParamBodyAngleY", mode: "set", scale: 10, min: -10, max: 10 },
    bodyZ: { target: "ParamBodyAngleZ", mode: "set", scale: 10, min: -10, max: 10 },
    eyeOpen: { targets: ["ParamEyeLOpen", "ParamEyeROpen"], mode: "set", scale: 1, min: 0, max: 1 },
    eyeBlinkL: { target: "ParamEyeLOpen", mode: "add", scale: -1, min: 0, max: 1 },
    eyeBlinkR: { target: "ParamEyeROpen", mode: "add", scale: -1, min: 0, max: 1 },
    eyeSmile: { targets: ["ParamEyeLSmile", "ParamEyeRSmile"], mode: "set", scale: 1, min: 0, max: 1 },
    gazeX: { target: "ParamEyeBallX", mode: "set", scale: 1, min: -1, max: 1 },
    gazeY: { target: "ParamEyeBallY", mode: "set", scale: 1, min: -1, max: 1 },
    browInnerUp: { targets: ["ParamBrowLY", "ParamBrowRY"], mode: "set", scale: 1, min: -1, max: 1 },
    browDown: { targets: ["ParamBrowLY", "ParamBrowRY"], mode: "subtract", scale: 0.85, min: -1, max: 1 },
    browTense: { targets: ["ParamBrowLForm", "ParamBrowRForm"], mode: "set", scale: 1, min: -1, max: 1 },
    mouthOpen: { target: "ParamMouthOpenY", mode: "set", scale: 1, min: 0, max: 1 },
    mouthSmile: { target: "ParamMouthForm", mode: "set", scale: 1, min: -1, max: 1 },
    mouthFrown: { target: "ParamMouthForm", mode: "subtract", scale: 1, min: -1, max: 1 },
    // Standard FACS channels stay in the profile; named private emotion
    // parameters such as Param9/Param10 are driven by setPrivateVADParameters.
    blush: { target: "ParamCheek", mode: "set", scale: 1, min: 0, max: 1 },
    tear: { target: "Param9", mode: "set", scale: 1, min: 0, max: 1 },
    breath: { target: "ParamBreath", mode: "set", scale: 1, min: 0, max: 1 }
  },
  idleConfig: {}
};

if (activeModel.profileOverrides) {
  fallbackProfile.parameterMap = {
    ...fallbackProfile.parameterMap,
    ...activeModel.profileOverrides.parameterMap
  };
  fallbackProfile.privateEmotionMap = activeModel.profileOverrides.privateEmotionMap;
  fallbackProfile.expressionMap = activeModel.profileOverrides.expressionMap;
}
for (const key of activeModel.unsupportedFallbackParameters ?? []) {
  delete fallbackProfile.parameterMap[key];
}
fallbackProfile.capabilities = detectCapabilities(fallbackProfile);

async function loadGeneratedProfile() {
  try {
    const response = await fetch(profileUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const generated = await response.json();
    if (!generated || typeof generated !== "object" || !generated.parameterMap) {
      throw new Error("profile 缺少 parameterMap");
    }
    generated.capabilities ??= detectCapabilities(generated);
    return { profile: generated, source: generated.autoProfile?.provider ?? "generated" };
  } catch (error) {
    console.warn("[Soullink] 自动 profile 加载失败，使用浏览器后备映射", error);
    return { profile: fallbackProfile, source: "fallback" };
  }
}

const { profile, source: profileSource } = await loadGeneratedProfile();

const elements = {
  stage: document.querySelector("#stage"),
  modelSelect: document.querySelector("#model-select"),
  modelName: document.querySelector("#model-name"),
  status: document.querySelector("#status"),
  form: document.querySelector("#message-form"),
  message: document.querySelector("#message"),
  reactionSubmit: document.querySelector("#reaction-submit"),
  reactionSubmitLabel: document.querySelector("#reaction-submit-label"),
  conversationSubmit: document.querySelector("#conversation-submit"),
  conversationResult: document.querySelector("#conversation-result"),
  conversationStatus: document.querySelector("#conversation-status"),
  conversationDuration: document.querySelector("#conversation-duration"),
  aiResult: document.querySelector("#ai-result"),
  aiResultSource: document.querySelector("#ai-result-source"),
  aiResultEmotion: document.querySelector("#ai-result-emotion"),
  aiReply: document.querySelector("#ai-reply"),
  speakingMotionText: document.querySelector("#speaking-motion-text"),
  speakingMotionGenerate: document.querySelector("#speaking-motion-generate"),
  speakingMotionResult: document.querySelector("#speaking-motion-result"),
  speakingMotionProvider: document.querySelector("#speaking-motion-provider"),
  speakingMotionStats: document.querySelector("#speaking-motion-stats"),
  speakingMotionTimeline: document.querySelector("#speaking-motion-timeline"),
  speakingFrameCount: document.querySelector("#speaking-frame-count"),
  speakingFrameInterval: document.querySelector("#speaking-frame-interval"),
  speakingDuration: document.querySelector("#speaking-duration"),
  jevReplaySelect: document.querySelector("#jev-replay-select"),
  jevReplayPlay: document.querySelector("#jev-replay-play"),
  jevReplayStop: document.querySelector("#jev-replay-stop"),
  jevReplayStatus: document.querySelector("#jev-replay-status"),
  jevReplayProgress: document.querySelector("#jev-replay-progress"),
  jevReplayTime: document.querySelector("#jev-replay-time"),
  jevReplayCoverage: document.querySelector("#jev-replay-coverage"),
  emotion: document.querySelector("#emotion"),
  valence: document.querySelector("#valence"),
  arousal: document.querySelector("#arousal"),
  dominance: document.querySelector("#dominance"),
  paramCount: document.querySelector("#param-count"),
  fps: document.querySelector("#fps"),
  parameters: document.querySelector("#parameters"),
  scale: document.querySelector("#scale"),
  offsetX: document.querySelector("#offset-x"),
  offsetY: document.querySelector("#offset-y"),
  parameterGain: document.querySelector("#parameter-gain"),
  bodyGain: document.querySelector("#body-gain"),
  scaleValue: document.querySelector("#scale-value"),
  xValue: document.querySelector("#x-value"),
  yValue: document.querySelector("#y-value"),
  parameterGainValue: document.querySelector("#parameter-gain-value"),
  bodyGainValue: document.querySelector("#body-gain-value")
};

const motionStyleElements = {
  spontaneity: document.querySelector("#spontaneity"),
  gestureFrequency: document.querySelector("#gesture-frequency"),
  gazeStability: document.querySelector("#gaze-stability"),
  idleActionGain: document.querySelector("#idle-action-gain")
};

const motionStyleOutputs = {
  spontaneity: document.querySelector("#spontaneity-value"),
  gestureFrequency: document.querySelector("#gesture-frequency-value"),
  gazeStability: document.querySelector("#gaze-stability-value"),
  idleActionGain: document.querySelector("#idle-action-gain-value")
};

const vadElements = {
  valence: document.querySelector("#vad-valence"),
  arousal: document.querySelector("#vad-arousal"),
  dominance: document.querySelector("#vad-dominance")
};

const vadOutputs = {
  valence: document.querySelector("#vad-valence-value"),
  arousal: document.querySelector("#vad-arousal-value"),
  dominance: document.querySelector("#vad-dominance-value")
};

const missingParameters = new Set();
const runtime = new SoullinkRuntime({ profile });
const renderer = new Live2DRenderer(elements.stage, {
  cubismLoader: createScriptTagCubismLoader(coreUrl),
  onMissingParameter: (id) => missingParameters.add(id)
});

let startTime = performance.now() / 1000;
let lastFrameTime = startTime;
let lastTelemetryTime = 0;
let frameCounter = 0;
let displayedFps = 0;
let expressionToken = 1;
let selectedEmotion = "neutral";
let manualNativeAnimation = false;
let reactionMode = "local";
let reactionBusy = false;
let latestSnapshot = null;
let modelParameters = {};
let speakingMotionMode = "fixed-parallel";
let speakingMotionBusy = false;
let lastSpeakingMotionPlan = null;
let jevReplay = null;
const manualFacs = {};
let renderedParameters = {};
const conversation = createConversationController({
  getMetadata: () => modelParameters,
  capturePose: () => {
    const actual = renderer.getParameters();
    return Object.fromEntries(Object.entries(modelParameters).map(([id, p]) => [id, Math.max(p.min, Math.min(p.max, actual[id] ?? renderedParameters[id] ?? p.default))]));
  },
  getModel: () => activeModel,
  setStatus,
  onStart: () => { stopJevReplay(); runtime.clearSpeechMotion(); manualNativeAnimation = false; renderer.applyNativeAnimation(null); }
});

function setStatus(text, kind = "ready") {
  elements.status.className = `status ${kind}`;
  elements.status.replaceChildren(document.createElement("span"), document.createTextNode(text));
}

function triggerLocalMessage(message) {
  const now = performance.now() / 1000 - startTime;
  const intent = runtime.sendMessage(message, now);
  manualNativeAnimation = false;
  const vad = getVADPreset(intent.emotion, intent.variant);
  selectedEmotion = intent.emotion;
  elements.message.value = message;
  renderVADTarget(vad);
  markSelectedEmotion(intent.emotion);
  renderReactionResult("LOCAL", intent.emotion, `${intent.variant} · ${intent.intensity.toFixed(2)}`);
  setStatus(`已触发：${intent.emotion}`);
}

async function triggerMessage(message) {
  if (reactionMode === "local") {
    triggerLocalMessage(message);
    return;
  }

  const activeMode = reactionMode;
  manualNativeAnimation = false;
  setReactionBusy(true);
  setStatus(activeMode === "llm" ? "LLM 规划中" : "Embedding 分类中", "loading");

  try {
    if (activeMode === "embedding") {
      const result = await aiClient.classifyWithEmbedding({ message });
      const intent = result.intent;
      const vad = getVADPreset(intent.emotion, intent.variant);
      runtime.triggerIntent(intent, runtimeTime(), { vadTarget: vad, seed: Date.now() % 1_000_000 });
      runtime.applyVADTarget(vad, 1);
      selectedEmotion = intent.emotion;
      elements.message.value = message;
      renderVADTarget(vad);
      markSelectedEmotion(intent.emotion);
      renderReactionResult(
        `EMBEDDING · ${result.exampleCount}`,
        intent.emotion,
        `${intent.variant} · ${intent.intensity.toFixed(2)}`
      );
      setStatus(`Embedding：${intent.emotion}`);
      return;
    }

    const plan = await aiClient.planReaction({
      message,
      characterName: activeModel.displayName,
      characterProfile: "温和、自然、有表现力的 Live2D 角色",
      vad: latestSnapshot?.vad.current
    });
    runtime.triggerPlan(plan, runtimeTime());
    selectedEmotion = plan.intent.emotion;
    elements.message.value = message;
    renderVADTarget(plan.vadTarget);
    markSelectedEmotion(plan.intent.emotion);
    renderReactionResult("LLM · ONLINE", plan.intent.emotion, plan.replyDraft);
    setStatus(`LLM：${plan.intent.emotion}`);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    renderReactionResult("AI ERROR", "error", messageText);
    setStatus("AI 调用失败", "error");
    throw error;
  } finally {
    setReactionBusy(false);
  }
}

function setReactionMode(mode) {
  if (!(mode in reactionModeLabels)) return;
  reactionMode = mode;
  elements.reactionSubmitLabel.textContent = document.querySelector("#conversation-enabled").checked ? "发送消息" : reactionModeLabels[mode];
  const voiceMode = document.querySelector("#conversation-enabled").checked;
  document.querySelector(".reaction-mode").hidden = voiceMode;
  document.querySelector(".provider-status").hidden = voiceMode;
  for (const button of document.querySelectorAll("[data-reaction-mode]")) {
    const active = button.dataset.reactionMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function runtimeTime() {
  return performance.now() / 1000 - startTime;
}

function setReactionBusy(busy) {
  reactionBusy = busy;
  elements.reactionSubmit.disabled = busy;
  elements.message.readOnly = busy;
}

function renderReactionResult(source, emotion, text) {
  elements.aiResult.hidden = false;
  elements.aiResultSource.textContent = source;
  elements.aiResultEmotion.textContent = emotion;
  elements.aiReply.textContent = text;
  elements.aiReply.hidden = !text;
}

async function loadAIProviderStatus() {
  const embeddingElement = document.querySelector("#embedding-provider-status");
  const llmElement = document.querySelector("#llm-provider-status");
  const [embedding, llm] = await Promise.allSettled([
    aiClient.getEmbeddingConfig(),
    aiClient.getLlmConfig()
  ]);

  renderProviderStatus(embeddingElement, embedding, "Embedding");
  renderProviderStatus(llmElement, llm, "LLM");
}

function renderProviderStatus(element, result, label) {
  if (result.status === "rejected") {
    element.className = "error";
    element.replaceChildren(document.createElement("i"), document.createTextNode(`${label} 不可用`));
    return;
  }
  const model = result.value.model?.split("/").at(-1) ?? "未配置";
  const configured = Boolean(result.value.configured);
  element.className = configured ? "ready" : "error";
  element.replaceChildren(document.createElement("i"), document.createTextNode(model));
  element.title = `${label}: ${result.value.model ?? "未配置"}`;
}

function setSpeakingMotionMode(mode) {
  if (mode !== "fixed-parallel" && mode !== "duration") return;
  speakingMotionMode = mode;
  for (const button of document.querySelectorAll("[data-motion-mode]")) {
    const active = button.dataset.motionMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  document.querySelector("#speaking-frame-count-row").hidden = mode === "duration";
  document.querySelector("#speaking-duration-row").hidden = mode !== "duration";
}

function updateSpeakingMotionControls() {
  document.querySelector("#speaking-frame-count-value").value = elements.speakingFrameCount.value;
  document.querySelector("#speaking-frame-interval-value").value =
    `${Number(elements.speakingFrameInterval.value).toFixed(2)} s`;
  document.querySelector("#speaking-duration-value").value =
    `${Number(elements.speakingDuration.value).toFixed(1)} s`;
}

async function generateSpeakingMotion() {
  if (speakingMotionBusy) return;
  const speechText = elements.speakingMotionText.value.trim();
  if (!speechText) {
    setStatus("请输入动作文本", "error");
    return;
  }
  if (Object.keys(modelParameters).length === 0) {
    setStatus("模型参数尚未就绪", "error");
    return;
  }

  speakingMotionBusy = true;
  elements.speakingMotionGenerate.disabled = true;
  elements.speakingMotionGenerate.firstElementChild.textContent = "正在生成两阶段动作";
  setStatus("LLM 多帧规划中", "loading");

  try {
    const frameIntervalSec = Number(elements.speakingFrameInterval.value);
    const durationSec = Number(elements.speakingDuration.value);
    const plan = await aiClient.planSpeakingMotion({
      speechText,
      mode: speakingMotionMode,
      frameCount: speakingMotionMode === "fixed-parallel"
        ? Number(elements.speakingFrameCount.value)
        : undefined,
      durationSec: speakingMotionMode === "duration" ? durationSec : undefined,
      frameIntervalSec,
      availableParameters: modelParameters,
      intent: latestSnapshot?.emotionIntent,
      vad: latestSnapshot?.vad.current,
      characterName: activeModel.displayName,
      characterProfile: "温和、自然、有表现力的 Live2D 角色",
      userMessage: elements.message.value.trim()
    });
    lastSpeakingMotionPlan = plan;
    renderSpeakingMotionPlan(plan);

    if (plan.provider !== "openai-compatible" || plan.parameterPlan.length === 0) {
      const reason = plan.debug?.fallbackReason ?? "没有生成可播放的参数帧";
      setStatus("多帧规划已降级", "error");
      throw new Error(reason);
    }

    const playbackDuration = speakingMotionDuration(plan.parameterPlan, frameIntervalSec);
    runtime.startSpeechMotion(plan.parameterPlan, runtimeTime(), playbackDuration);
    setStatus(`多帧动作播放中 · ${plan.parameterPlan.length} 帧`);
  } catch (error) {
    console.error("[Soullink] speaking motion failed", error);
    if (!lastSpeakingMotionPlan) {
      elements.speakingMotionResult.hidden = false;
      elements.speakingMotionProvider.textContent = "ERROR";
      elements.speakingMotionStats.textContent = error instanceof Error ? error.message : String(error);
    }
  } finally {
    speakingMotionBusy = false;
    elements.speakingMotionGenerate.disabled = false;
    elements.speakingMotionGenerate.firstElementChild.textContent = "生成并播放多帧动作";
  }
}

function stopSpeakingMotion() {
  runtime.clearSpeechMotion();
  setStatus("多帧动作已停止");
}

const jevDiscreteParameterIds = new Set([
  "Param68", "Param69", "Param70", "Param72", "Param71", "Param73", "Param74",
  "Param75", "Param76", "Param77", "Param108", "Param86", "Param87"
]);

function setJevReplayStatus(text, kind = "") {
  elements.jevReplayStatus.textContent = text;
  elements.jevReplayStatus.className = `replay-status ${kind}`.trim();
}

function replayParametersAt(replay, elapsed) {
  return sampleReplay(replay, elapsed);
}

function beginJevReplay(replay, label = "JEV") {
  replay.discreteParameterIds ??= [...jevDiscreteParameterIds];
  replay.smoothedDiscreteParameterIds ??= [...replay.discreteParameterIds];
  validateReplay(replay, modelParameters);
  conversation.stop(false);
  const keyframes = Array.isArray(replay.keyframes) ? replay.keyframes : [];
  const modelIds = Object.keys(modelParameters);
  const replayIds = new Set(keyframes.flatMap((frame) => Object.keys(frame.parameters ?? {})));
  const covered = modelIds.filter((id) => replayIds.has(id));
  if (keyframes.length < 2 || covered.length !== modelIds.length) {
    throw new Error(`参数不匹配：回放 ${covered.length}/${modelIds.length}`);
  }
  runtime.clearSpeechMotion();
  manualNativeAnimation = true;
  renderer.applyNativeAnimation(null);
  jevReplay = {
    replay,
    startedAt: runtimeTime(),
    duration: Number(replay.durationSec) || 1,
    phase: "playing",
    coverage: covered.length,
    total: modelIds.length,
    label,
    currentParameters: replayParametersAt(replay, 0)
  };
  elements.jevReplayCoverage.textContent = `${covered.length}/${modelIds.length} 参数`;
  elements.jevReplayProgress.style.width = "0%";
  elements.jevReplayTime.textContent = `0.00 / ${jevReplay.duration.toFixed(2)} s`;
  setJevReplayStatus("播放中", "playing");
  setStatus(`${label} 关键帧播放中 · ${covered.length} 参数`);
  return jevReplay;
}

async function startJevReplay(replayOverride = null) {
  if (Object.keys(modelParameters).length === 0) {
    setJevReplayStatus("模型未就绪", "error");
    setStatus("模型参数尚未就绪", "error");
    return;
  }

    const url = elements.jevReplaySelect.value;
  elements.jevReplayPlay.disabled = true;
  setJevReplayStatus("加载中", "playing");
  try {
    if (replayOverride) {
      beginJevReplay(replayOverride, "JEV 测试");
    } else {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`回放文件 HTTP ${response.status}`);
      beginJevReplay(await response.json(), "JEV");
    }
  } catch (error) {
    jevReplay = null;
    setJevReplayStatus("加载失败", "error");
    elements.jevReplayCoverage.textContent = "参数未加载";
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    elements.jevReplayPlay.disabled = false;
  }
}

function stopJevReplay() {
  if (!jevReplay) {
    setJevReplayStatus("待机");
    return;
  }
  jevReplay = null;
  manualNativeAnimation = false;
  elements.jevReplayProgress.style.width = "0%";
  elements.jevReplayTime.textContent = "0.00 / 1.00 s";
  setJevReplayStatus("已停止");
  setStatus("JEV 回放已停止");
}

function updateJevReplay(now) {
  if (!jevReplay) return null;
  const elapsed = Math.max(0, now - jevReplay.startedAt);
  const clamped = Math.min(jevReplay.duration, elapsed);
  if (jevReplay.phase === "playing" && elapsed >= jevReplay.duration) {
    jevReplay.phase = "complete";
    setJevReplayStatus("已完成");
    setStatus("JEV 关键帧播放完成");
  }
  const progress = jevReplay.duration > 0 ? clamped / jevReplay.duration : 1;
  jevReplay.currentParameters = replayParametersAt(jevReplay.replay, clamped);
  elements.jevReplayProgress.style.width = `${(progress * 100).toFixed(2)}%`;
  elements.jevReplayTime.textContent = `${clamped.toFixed(2)} / ${jevReplay.duration.toFixed(2)} s`;
  return jevReplay.currentParameters;
}


function speakingMotionDuration(parameterPlan, fallbackInterval) {
  return Math.max(
    0.4,
    ...parameterPlan.map((beat) => Number(beat.time) + Number(beat.duration || fallbackInterval))
  );
}

function renderSpeakingMotionPlan(plan) {
  elements.speakingMotionResult.hidden = false;
  elements.speakingMotionProvider.textContent = plan.provider.toUpperCase();
  const parameterIds = new Set(plan.parameterPlan.flatMap((beat) => Object.keys(beat.parameters ?? {})));
  const elapsed = plan.debug?.elapsedMs ? ` · ${(plan.debug.elapsedMs / 1000).toFixed(1)} s 生成` : "";
  elements.speakingMotionStats.textContent =
    `${plan.parameterPlan.length} 帧 · ${parameterIds.size} 参数${elapsed}`;
  elements.speakingMotionTimeline.replaceChildren();

  for (const [index, beat] of plan.parameterPlan.entries()) {
    const semantic = plan.motionPlan?.find((frame) => frame.frameIndex === index);
    const item = document.createElement("li");
    const time = document.createElement("time");
    const action = document.createElement("strong");
    const parameters = document.createElement("small");
    time.textContent = `${Number(beat.time).toFixed(2)}s`;
    action.textContent = semantic?.action ?? beat.label ?? `Frame ${index + 1}`;
    parameters.textContent = Object.entries(beat.parameters ?? {})
      .slice(0, 5)
      .map(([id, value]) => `${id}=${Number(value).toFixed(2)}`)
      .join(" · ");
    item.append(time, action, parameters);
    elements.speakingMotionTimeline.appendChild(item);
  }
}

function vadFromControls() {
  return {
    valence: Number(vadElements.valence.value),
    arousal: Number(vadElements.arousal.value),
    dominance: Number(vadElements.dominance.value)
  };
}

function renderVADTarget(vad) {
  for (const axis of ["valence", "arousal", "dominance"]) {
    vadElements[axis].value = String(vad[axis]);
    vadOutputs[axis].value = Number(vad[axis]).toFixed(2);
  }
  document.querySelector("#vad-target").textContent =
    `V ${formatSigned(vad.valence)} · A ${formatSigned(vad.arousal)} · D ${formatSigned(vad.dominance)}`;
}

function applyVADControls() {
  const vad = vadFromControls();
  selectedEmotion = "custom";
  runtime.applyVADTarget(vad, 1);
  renderVADTarget(vad);
  markSelectedEmotion(null);
  setStatus("自定义 VAD 已应用");
}

function triggerEmotionPreset(emotion) {
  const vad = emotionVADPresets[emotion];
  if (!vad) return;
  selectedEmotion = emotion;
  manualNativeAnimation = false;
  const now = performance.now() / 1000 - startTime;
  const intensity = Math.max(0.35, Math.min(1, (
    Math.abs(vad.valence) + Math.abs(vad.arousal) + Math.abs(vad.dominance)
  ) / 2));
  runtime.triggerIntent(
    {
      emotion,
      variant: emotionVariants[emotion],
      naturalEmotion: emotion,
      naturalVAD: vad,
      intensity,
      contextTags: ["manual_preset"]
    },
    now,
    { vadTarget: vad }
  );
  runtime.applyVADTarget(vad, 1);
  renderVADTarget(vad);
  markSelectedEmotion(emotion);
  setStatus(`情绪预设：${emotionLabels[emotion] ?? emotion}`);
}

function markSelectedEmotion(emotion) {
  for (const button of document.querySelectorAll("[data-emotion]")) {
    button.classList.toggle("active", button.dataset.emotion === emotion);
  }
}

function buildEmotionControls() {
  const container = document.querySelector("#emotion-actions");
  for (const [emotion, vad] of Object.entries(emotionVADPresets)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.emotion = emotion;
    button.title = `V ${formatSigned(vad.valence)} / A ${formatSigned(vad.arousal)} / D ${formatSigned(vad.dominance)}`;
    button.innerHTML = `<strong>${emotionLabels[emotion] ?? emotion}</strong><small>${emotion}</small>`;
    container.appendChild(button);
  }
  document.querySelector("#emotion-count").textContent = String(Object.keys(emotionVADPresets).length);
  markSelectedEmotion("neutral");
}

function buildFACSControls() {
  const container = document.querySelector("#facs-controls");
  for (const group of facsGroups) {
    const details = document.createElement("details");
    details.className = "facs-group";
    details.open = Boolean(group.open);
    const summary = document.createElement("summary");
    summary.innerHTML = `<span>${group.label}</span><small>${group.controls.length}</small>`;
    details.appendChild(summary);

    for (const [key, label, min = 0, max = 1, initial = 0] of group.controls) {
      const row = document.createElement("label");
      row.className = "facs-row";
      row.dataset.facsRow = key;
      row.innerHTML = `${label}<output id="facs-${key}-value">AUTO</output><input id="facs-${key}" data-facs="${key}" data-default="${initial}" autocomplete="off" type="range" min="${min}" max="${max}" step="0.01" value="${initial}" />`;
      details.appendChild(row);
    }
    container.appendChild(details);
  }
}

function updateFACSOverride(input) {
  const key = input.dataset.facs;
  const value = Number(input.value);
  manualFacs[key] = value;
  runtime.setManualFACS(manualFacs);
  const row = input.closest(".facs-row");
  row.classList.add("active");
  row.querySelector("output").value = value.toFixed(2);
  renderFACSOverrideStatus();
}

function resetFACSOverrides() {
  for (const key of Object.keys(manualFacs)) delete manualFacs[key];
  runtime.clearManualFACS();
  for (const row of document.querySelectorAll(".facs-row")) {
    row.classList.remove("active");
    row.querySelector("output").value = "AUTO";
    const input = row.querySelector("input[data-facs]");
    input.value = input.dataset.default;
  }
  renderFACSOverrideStatus();
  setStatus("FACS 已恢复自动");
}

function renderFACSOverrideStatus() {
  const count = Object.keys(manualFacs).length;
  document.querySelector("#facs-override-count").textContent = `${count ? "手动" : "自动"} · ${count}/24`;
  document.querySelector("#facs-mode-dot").classList.toggle("active", count > 0);
}

function formatSigned(value) {
  return `${value >= 0 ? "+" : ""}${Number(value).toFixed(2)}`;
}

function updateView() {
  const scale = Number(elements.scale.value);
  const x = Number(elements.offsetX.value);
  const y = Number(elements.offsetY.value);
  renderer.setViewScale(scale);
  renderer.setViewOffset({ x, y });
  elements.scaleValue.value = `${scale.toFixed(2)}×`;
  document.querySelector("#model-zoom-value").value = `${Math.round(scale * 100)}%`;
  document.querySelector("#model-zoom-out").disabled = scale <= Number(elements.scale.min);
  document.querySelector("#model-zoom-in").disabled = scale >= Number(elements.scale.max);
  elements.xValue.value = `${x}px`;
  elements.yValue.value = `${y}px`;
}

function zoomModel(scale) {
  elements.scale.value = String(Math.max(Number(elements.scale.min), Math.min(Number(elements.scale.max), scale)));
  updateView();
}

function buildModelSelector() {
  elements.modelName.textContent = activeModel.displayName;
  document.title = `Soullink Emotion · ${activeModel.displayName}`;
  const groups = new Map([["JEV 参数控制", modelCatalog.filter(model => model.supportsJev)], ["本地参数控制", modelCatalog.filter(model => !model.supportsJev)]]);
  for (const [label, models] of groups) {
    if (!models.length) continue;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.displayName;
      option.selected = model.id === activeModel.id;
      group.appendChild(option);
    }
    elements.modelSelect.appendChild(group);
  }
}

function configureJevReplayOptions() {
  const options = [...elements.jevReplaySelect.options];
  const matching = options.filter(option => !option.dataset.model || option.dataset.model === activeModel.id);
  for (const option of options) option.hidden = !matching.includes(option);
  if (matching.length === 0) {
    elements.jevReplaySelect.disabled = true;
    elements.jevReplayPlay.disabled = true;
    setJevReplayStatus("暂无匹配回放");
    elements.jevReplayCoverage.textContent = "请生成或导入当前模型的 JEV 关键帧";
    return;
  }
  elements.jevReplaySelect.disabled = false;
  elements.jevReplayPlay.disabled = false;
  elements.jevReplaySelect.value = matching[0].value;
}

function selectMotionStyle(name, announce = true) {
  const preset = motionStylePresets[name];
  if (!preset) return;
  for (const [key, input] of Object.entries(motionStyleElements)) {
    input.value = String(preset[key]);
  }
  runtime.setMotionStyle({ ...preset, seed: runtime.getMotionStyle().seed });
  renderMotionStyleControls();
  for (const button of document.querySelectorAll("[data-motion-style]")) {
    const active = button.dataset.motionStyle === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (announce) setStatus(`动作风格：${name}`);
}

function applyMotionStyleControls() {
  runtime.setMotionStyle(Object.fromEntries(
    Object.entries(motionStyleElements).map(([key, input]) => [key, Number(input.value)])
  ));
  renderMotionStyleControls();
  for (const button of document.querySelectorAll("[data-motion-style]")) {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  }
}

function renderMotionStyleControls() {
  motionStyleOutputs.spontaneity.value = `${Number(motionStyleElements.spontaneity.value).toFixed(2)}×`;
  motionStyleOutputs.gestureFrequency.value = `${Number(motionStyleElements.gestureFrequency.value).toFixed(2)}×`;
  motionStyleOutputs.gazeStability.value = Number(motionStyleElements.gazeStability.value).toFixed(2);
  motionStyleOutputs.idleActionGain.value = `${Number(motionStyleElements.idleActionGain.value).toFixed(2)}×`;
}

function updateMotionGain() {
  const parameterGain = Number(elements.parameterGain.value);
  const bodyGain = Number(elements.bodyGain.value);
  runtime.setParameterGain(parameterGain);
  runtime.setBodyMotionGain(bodyGain);
  elements.parameterGainValue.value = `${parameterGain.toFixed(2)}×`;
  elements.bodyGainValue.value = `${bodyGain.toFixed(2)}×`;
  setStatus(`动作幅度：${parameterGain.toFixed(2)}× / ${bodyGain.toFixed(2)}×`);
}

function resetMotionSettings() {
  elements.parameterGain.value = "1.45";
  elements.bodyGain.value = "1.25";
  selectMotionStyle("natural", false);
  updateMotionGain();
}

function buildNativeAnimationControls() {
  const container = document.querySelector("#native-animation-actions");
  const summary = document.querySelector("#native-animation-summary");
  const expressions = profile.nativeAnimations?.expressions ?? [];
  const motions = profile.nativeAnimations?.motions ?? [];
  summary.textContent = `${expressions.length} 个表情 · ${motions.length} 个动作`;

  for (const expression of expressions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.nativeExpression = expression.name;
    button.textContent = expression.name;
    container.appendChild(button);
  }
  for (const motion of motions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.nativeMotionGroup = motion.group;
    button.dataset.nativeMotionIndex = String(motion.index);
    button.textContent = `${motion.group} ${motion.index + 1}`;
    container.appendChild(button);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.dataset.nativeReset = "true";
  reset.textContent = "恢复";
  container.appendChild(reset);
}

function animate(timestamp) {
  const now = timestamp / 1000 - startTime;
  const absoluteNow = timestamp / 1000;
  const delta = Math.min(0.05, Math.max(1 / 240, absoluteNow - lastFrameTime));
  lastFrameTime = absoluteNow;

  const snapshot = runtime.update(now, delta);
  latestSnapshot = snapshot;
  const jevParameters = updateJevReplay(now);
  const conversationParameters = conversation.update(snapshot.live2dParams);
  renderedParameters = conversationParameters ? { ...snapshot.live2dParams, ...conversationParameters } : jevParameters ?? snapshot.live2dParams;
  renderer.setParameters(renderedParameters);
  if (conversationParameters || jevParameters) {
    renderer.applyNativeAnimation(null);
  } else if (!manualNativeAnimation) {
    const activeNativeAnimation =
      snapshot.state === "IDLE" || snapshot.state === "RECOVERING"
        ? null
        : snapshot.nativeAnimation;
    renderer.applyNativeAnimation(activeNativeAnimation);
  }
  frameCounter += 1;

  if (now - lastTelemetryTime >= 0.35) {
    displayedFps = Math.round(frameCounter / Math.max(0.001, now - lastTelemetryTime));
    frameCounter = 0;
    lastTelemetryTime = now;
    elements.emotion.textContent = snapshot.vad.dominantEmotion;
    elements.valence.textContent = snapshot.vad.current.valence.toFixed(3);
    elements.arousal.textContent = snapshot.vad.current.arousal.toFixed(3);
    elements.dominance.textContent = snapshot.vad.current.dominance.toFixed(3);
    elements.paramCount.textContent = String(Object.keys(renderedParameters).length);
    elements.fps.textContent = String(displayedFps);
    elements.parameters.textContent = JSON.stringify(
      {
        state: snapshot.state,
        emotion: snapshot.emotionIntent?.emotion ?? "neutral",
        vad: snapshot.vad.current,
        vadTarget: snapshot.vad.target,
        dominantEmotion: snapshot.vad.dominantEmotion,
        selectedEmotion,
        manualFACS: snapshot.manualFACS,
        parameterGain: snapshot.parameterGain,
        bodyMotionGain: snapshot.bodyMotionGain,
        motionStyle: snapshot.motionStyle,
        live2dParams: renderedParameters,
        missingParameters: [...missingParameters]
      },
      null,
      2
    );
  }

  requestAnimationFrame(animate);
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (reactionBusy) return;
  const message = elements.message.value.trim();
  if (!message) return;
  if (document.querySelector("#conversation-enabled").checked) {
    void conversation.submit(message);
    return;
  }
  conversation.stop(false);
  stopJevReplay();
  try {
    await triggerMessage(message);
  } catch (error) {
    console.error("[Soullink] AI reaction failed", error);
  }
});

document.querySelector(".reaction-mode").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-reaction-mode]");
  if (button) setReactionMode(button.dataset.reactionMode);
});

document.querySelector(".motion-mode").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-motion-mode]");
  if (button) setSpeakingMotionMode(button.dataset.motionMode);
});

elements.modelSelect.addEventListener("change", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("model", elements.modelSelect.value);
  window.location.assign(url);
});

for (const input of [elements.speakingFrameCount, elements.speakingFrameInterval, elements.speakingDuration]) {
  input.addEventListener("input", updateSpeakingMotionControls);
}

elements.speakingMotionGenerate.addEventListener("click", () => void generateSpeakingMotion());
document.querySelector("#speaking-motion-stop").addEventListener("click", stopSpeakingMotion);
elements.jevReplayPlay.addEventListener("click", () => void startJevReplay());
elements.jevReplayStop.addEventListener("click", stopJevReplay);
elements.conversationSubmit.addEventListener("click", () => void conversation.submit(elements.message.value.trim()));
document.querySelector("#conversation-enabled").addEventListener("change", () => { conversation.stop(false); setReactionMode(reactionMode); });

document.querySelector("#emotion-actions").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-emotion]");
  if (button) triggerEmotionPreset(button.dataset.emotion);
});

for (const input of Object.values(vadElements)) input.addEventListener("input", applyVADControls);

document.querySelector("#vad-reset").addEventListener("click", () => triggerEmotionPreset("neutral"));

document.querySelector("#decay").addEventListener("input", (event) => {
  const rate = Number(event.target.value);
  runtime.setVADDecayRate(rate);
  document.querySelector("#decay-value").value = `${rate.toFixed(3)} /s`;
});

document.querySelector("#facs-controls").addEventListener("input", (event) => {
  const input = event.target.closest("input[data-facs]");
  if (input) updateFACSOverride(input);
});

document.querySelector("#facs-reset").addEventListener("click", resetFACSOverrides);

for (const input of [elements.parameterGain, elements.bodyGain]) {
  input.addEventListener("input", updateMotionGain);
}

for (const input of Object.values(motionStyleElements)) {
  input.addEventListener("input", applyMotionStyleControls);
}

document.querySelector(".motion-style").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-motion-style]");
  if (button) selectMotionStyle(button.dataset.motionStyle);
});

document.querySelector("#motion-reset").addEventListener("click", resetMotionSettings);

document.querySelector("#native-animation-actions").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.nativeReset) {
    manualNativeAnimation = false;
    renderer.applyNativeAnimation(null);
    setStatus("原生动画已恢复");
    return;
  }
  manualNativeAnimation = true;
  if (button.dataset.nativeExpression) {
    renderer.applyNativeAnimation({
      token: expressionToken++,
      expression: button.dataset.nativeExpression,
      motion: null,
      suppressParamIds: []
    });
    setStatus(`原生表情：${button.textContent}`);
    return;
  }
  renderer.applyNativeAnimation({
    token: expressionToken++,
    expression: null,
    motion: {
      group: button.dataset.nativeMotionGroup,
      index: Number(button.dataset.nativeMotionIndex),
      priority: "force"
    },
    suppressParamIds: []
  });
  setStatus(`原生动作：${button.textContent}`);
});

for (const input of [elements.scale, elements.offsetX, elements.offsetY]) {
  input.addEventListener("input", updateView);
}

document.querySelector("#model-zoom-out").addEventListener("click", () => zoomModel(Number(elements.scale.value) - 0.1));
document.querySelector("#model-zoom-in").addEventListener("click", () => zoomModel(Number(elements.scale.value) + 0.1));
document.querySelector("#model-view-reset").addEventListener("click", () => {
  elements.offsetX.value = String(activeModel.view.x);
  elements.offsetY.value = String(activeModel.view.y);
  zoomModel(activeModel.view.scale);
});
elements.stage.addEventListener("wheel", event => {
  if (event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.stage.clientHeight : 1);
  zoomModel(Number(elements.scale.value) * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0015));
}, { passive: false });

window.addEventListener("beforeunload", () => renderer.destroy());

buildModelSelector();
configureJevReplayOptions();
refreshConversationIcons();
buildEmotionControls();
buildFACSControls();
buildNativeAnimationControls();
renderVADTarget(emotionVADPresets.neutral);
renderFACSOverrideStatus();
setReactionMode("local");
setSpeakingMotionMode("fixed-parallel");
updateSpeakingMotionControls();
void loadAIProviderStatus();
elements.scale.value = String(activeModel.view.scale);
elements.offsetX.value = String(activeModel.view.x);
elements.offsetY.value = String(activeModel.view.y);
elements.parameterGain.value = "1.45";
elements.bodyGain.value = "1.25";
document.querySelector("#decay").value = "0.018";
runtime.setVADDecayRate(0.018);
selectMotionStyle("natural", false);
updateMotionGain();

try {
  const parameters = await renderer.load(modelUrl);
  if (Object.keys(parameters).length === 0) throw new Error("模型未返回任何参数");
  modelParameters = parameters;
  const privateParameterSummary = runtime.setPrivateVADParameters(parameters);
  updateView();
  setStatus(
    `模型就绪 · ${Object.keys(parameters).length} 参数 · ` +
      `${privateParameterSummary.candidateCount} 情绪特效 · profile:${profileSource}`
  );
  window.__SOULLINK_TEST__ = {
    ready: true,
    renderer,
    runtime,
    profile,
    profileSource,
    activeModel,
    parameters,
    privateParameterSummary,
    aiClient,
    get speakingMotionPlan() { return lastSpeakingMotionPlan; },
    get modelParameters() { return modelParameters; },
    get latestSnapshot() { return latestSnapshot; },
    get jevReplay() { return jevReplay; },
    startJevReplay,
    stopJevReplay,
    get conversation() { return conversation.state; },
    get reactionMode() { return reactionMode; }
  };
  requestAnimationFrame(animate);
} catch (error) {
  console.error(error);
  setStatus("模型加载失败", "error");
  elements.parameters.textContent = error instanceof Error ? error.stack : String(error);
  window.__SOULLINK_TEST__ = { ready: false, error: String(error) };
}
