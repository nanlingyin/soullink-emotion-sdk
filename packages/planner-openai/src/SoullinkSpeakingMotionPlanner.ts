import {
  clamp,
  type EmotionIntent,
  type Live2DParamState,
  type PartialFACSLikeState,
  type SoullinkParameterBeat,
  type VADVector
} from "@soullink-emotion/engine";
import {
  isOpenAICompatibleClientLike,
  OpenAIClientNotConfiguredError,
  OpenAICompatibleClient
} from "./OpenAICompatibleClient";
import type {
  OpenAIChatMessage,
  OpenAICompatibleClientLike,
  OpenAIClientOptions,
  OpenAIJsonSchemaResponseFormat,
  OpenAIResponseFormat
} from "./openAICompatibleTypes";

export interface Live2DParameterInfo {
  name?: string;
  groupId?: string;
  groupName?: string;
  min: number;
  max: number;
  default: number;
}

export type SpeakingMotionGenerationMode = "duration" | "fixed" | "fixed-parallel";
export type ResolvedSpeakingMotionGenerationMode = "duration" | "fixed";

export interface SpeakingMotionGenerationConfig {
  mode?: SpeakingMotionGenerationMode;
  fixedFrameCount?: number;
  frameIntervalSec?: number;
  minFrameCount?: number;
  maxFrameCount?: number;
  twoStage?: boolean;
  temperature?: number;
  jointMotionBoost?: number;
  eyeOpenBinary?: boolean;
  minVisibleRatio?: number;
  maxPromptParameters?: number;
}

export interface SoullinkSpeakingMotionPlannerOptions {
  client?: OpenAICompatibleClientLike;
  openAI?: OpenAIClientOptions;
  generation?: SpeakingMotionGenerationConfig;
}

export interface ResolvedSpeakingMotionGenerationConfig {
  mode: ResolvedSpeakingMotionGenerationMode;
  fixedFrameCount: number;
  frameIntervalSec: number;
  minFrameCount: number;
  maxFrameCount: number;
  twoStage: boolean;
  temperature: number;
  jointMotionBoost: number;
  eyeOpenBinary: boolean;
  minVisibleRatio: number;
  maxPromptParameters: number;
}

export interface SpeakingMotionPlanRequest {
  speechText: string;
  durationSec?: number;
  availableParameters?: Record<string, Live2DParameterInfo>;
  intent?: Partial<EmotionIntent>;
  vad?: Partial<VADVector>;
  expression?: {
    emotion?: string;
    variant?: string;
    intensity?: number;
    peakFACS?: PartialFACSLikeState;
  } | null;
  characterName?: string;
  characterProfile?: string;
  userMessage?: string;
  model?: string;
  temperature?: number;
  openAI?: OpenAIClientOptions;
  mode?: SpeakingMotionGenerationMode;
  frameCount?: number;
  frameIntervalSec?: number;
}

export interface SpeakingMotionActionFrame {
  frameIndex: number;
  action: string;
  emphasis?: string;
}

export type SpeakingMotionFallbackCode =
  | "not_configured"
  | "no_available_parameters"
  | "invalid_duration"
  | "action_planning_failed"
  | "parameter_planning_failed";

export interface SpeakingMotionPlanDebug {
  model: string;
  baseURL: string;
  generationMode: ResolvedSpeakingMotionGenerationMode;
  requestedFrameCount: number;
  availableParameterCount: number;
  actionProvider?: "openai-compatible" | "vad-facs" | "disabled";
  actionFrameCount?: number;
  rawFrameCount?: number;
  usableRawFrameCount?: number;
  finalFrameCount: number;
  responseFormat?: string;
  fallbackCode?: SpeakingMotionFallbackCode;
  fallbackReason?: string;
  frameIntervalSec: number;
  frameDurationMs: number;
  speechTextForMotion: string;
  explicitMotionDirectives: string[];
  jointMotionBoost: number;
  eyeOpenBinary: boolean;
  minVisibleRatio: number;
  elapsedMs: number;
}

export interface SpeakingMotionPlan {
  parameterPlan: SoullinkParameterBeat[];
  provider: "openai-compatible" | "vad-facs";
  motionPlan?: SpeakingMotionActionFrame[];
  rawMessage?: OpenAIChatMessage;
  rawMotionPlanMessage?: OpenAIChatMessage;
  debug?: SpeakingMotionPlanDebug;
}

interface RawParameterPlan {
  parameterPlan?: unknown;
  parameter_plan?: unknown;
  frames?: unknown;
}

interface RawActionPlan {
  motionPlan?: unknown;
  motion_plan?: unknown;
  frames?: unknown;
}

interface SpeechInstruction {
  originalSpeechText: string;
  speechTextForMotion: string;
  explicitMotionDirectives: string[];
}

interface ActionResult {
  frames: SpeakingMotionActionFrame[];
  provider: "openai-compatible" | "vad-facs" | "disabled";
  rawMessage?: OpenAIChatMessage;
  error?: unknown;
}

export const defaultSpeakingMotionGenerationConfig: Readonly<ResolvedSpeakingMotionGenerationConfig> =
  Object.freeze({
    mode: "fixed",
    fixedFrameCount: 4,
    frameIntervalSec: 1,
    minFrameCount: 1,
    maxFrameCount: 60,
    twoStage: true,
    temperature: 0.22,
    jointMotionBoost: 1.35,
    eyeOpenBinary: true,
    minVisibleRatio: 0.08,
    maxPromptParameters: 96
  });

export function resolveSpeakingMotionGenerationConfig(
  config: SpeakingMotionGenerationConfig = {}
): ResolvedSpeakingMotionGenerationConfig {
  const minFrameCount = integer(config.minFrameCount, 1, 600, 1);
  const maxFrameCount = integer(config.maxFrameCount, minFrameCount, 600, 60);
  return {
    mode: config.mode === "duration" ? "duration" : "fixed",
    fixedFrameCount: integer(config.fixedFrameCount, minFrameCount, maxFrameCount, 4),
    frameIntervalSec: number(config.frameIntervalSec, 0.1, 30, 1),
    minFrameCount,
    maxFrameCount,
    twoStage: config.twoStage ?? true,
    temperature: number(config.temperature, 0, 2, 0.22),
    jointMotionBoost: number(config.jointMotionBoost, 0.25, 4, 1.35),
    eyeOpenBinary: config.eyeOpenBinary ?? true,
    minVisibleRatio: number(config.minVisibleRatio, 0, 0.5, 0.08),
    maxPromptParameters: integer(config.maxPromptParameters, 8, 256, 96)
  };
}

export function resolveSpeakingMotionFrameCount(
  request: Pick<SpeakingMotionPlanRequest, "durationSec" | "frameCount">,
  config: ResolvedSpeakingMotionGenerationConfig
): number {
  if (positive(request.frameCount)) {
    return clampInteger(request.frameCount, config.minFrameCount, config.maxFrameCount);
  }
  if (config.mode === "fixed") {
    return clampInteger(config.fixedFrameCount, config.minFrameCount, config.maxFrameCount);
  }
  if (!positive(request.durationSec)) return 0;
  return clampInteger(
    Math.ceil(request.durationSec / config.frameIntervalSec),
    config.minFrameCount,
    config.maxFrameCount
  );
}

export class SoullinkSpeakingMotionPlanner {
  private client: OpenAICompatibleClientLike;
  private openAIOptions: OpenAIClientOptions;
  private generation: ResolvedSpeakingMotionGenerationConfig;

  constructor(
    clientOrOptions: OpenAICompatibleClientLike | OpenAIClientOptions = {},
    generationConfig: SpeakingMotionGenerationConfig = {}
  ) {
    this.client = isOpenAICompatibleClientLike(clientOrOptions)
      ? clientOrOptions
      : new OpenAICompatibleClient(clientOrOptions);
    this.openAIOptions = isOpenAICompatibleClientLike(clientOrOptions) ? {} : { ...clientOrOptions };
    this.generation = resolveSpeakingMotionGenerationConfig(generationConfig);
  }

  static create(options: SoullinkSpeakingMotionPlannerOptions = {}): SoullinkSpeakingMotionPlanner {
    return new SoullinkSpeakingMotionPlanner(
      options.client ?? options.openAI ?? {},
      options.generation
    );
  }

  get config() {
    return { openAI: this.client.config, generation: { ...this.generation } };
  }

  async plan(request: SpeakingMotionPlanRequest): Promise<SpeakingMotionPlan> {
    const startedAt = Date.now();
    const generation = resolveSpeakingMotionGenerationConfig({
      ...this.generation,
      mode: request.mode ?? this.generation.mode,
      frameIntervalSec: request.frameIntervalSec ?? this.generation.frameIntervalSec
    });
    const frameCount = resolveSpeakingMotionFrameCount(request, generation);
    const available = sanitizeAvailableParameters(request.availableParameters);
    const speech = analyzeSpeech(request.speechText, request.userMessage);
    const openAI: OpenAIClientOptions = {
      ...this.openAIOptions,
      ...request.openAI,
      ...(request.model ? { model: request.model } : {})
    };
    const debug = (detail: Partial<SpeakingMotionPlanDebug>): SpeakingMotionPlanDebug => ({
      model: request.model ?? openAI.model ?? this.client.config.model,
      baseURL: openAI.baseURL ?? this.client.config.baseURL,
      generationMode: generation.mode,
      requestedFrameCount: frameCount,
      availableParameterCount: Object.keys(available).length,
      finalFrameCount: 0,
      frameIntervalSec: generation.frameIntervalSec,
      frameDurationMs: generation.frameIntervalSec * 1000,
      speechTextForMotion: speech.speechTextForMotion,
      explicitMotionDirectives: speech.explicitMotionDirectives,
      jointMotionBoost: generation.jointMotionBoost,
      eyeOpenBinary: generation.eyeOpenBinary,
      minVisibleRatio: generation.minVisibleRatio,
      elapsedMs: Date.now() - startedAt,
      ...detail
    });
    const vadFacs = (
      code: SpeakingMotionFallbackCode,
      reason: string,
      detail: Partial<SpeakingMotionPlan> & Partial<SpeakingMotionPlanDebug> = {}
    ): SpeakingMotionPlan => ({
      parameterPlan: [],
      provider: "vad-facs",
      motionPlan: detail.motionPlan,
      rawMessage: detail.rawMessage,
      rawMotionPlanMessage: detail.rawMotionPlanMessage,
      debug: debug({
        actionProvider: detail.actionProvider,
        actionFrameCount: detail.actionFrameCount,
        rawFrameCount: detail.rawFrameCount,
        usableRawFrameCount: detail.usableRawFrameCount,
        responseFormat: detail.responseFormat,
        fallbackCode: code,
        fallbackReason: reason
      })
    });

    if (generation.mode === "duration" && frameCount === 0) {
      return vadFacs("invalid_duration", "duration mode requires a positive durationSec");
    }
    if (Object.keys(available).length === 0) {
      return vadFacs("no_available_parameters", "No usable Live2D parameters were provided");
    }
    if (!this.client.isConfigured(openAI)) {
      return vadFacs("not_configured", "OpenAI-compatible client is not configured");
    }

    const actions = await this.planActions(request, available, frameCount, generation, openAI, speech);
    if (generation.twoStage && actions.provider !== "openai-compatible") {
      return vadFacs("action_planning_failed", errorText(actions.error, "Semantic action planning failed"), {
        rawMotionPlanMessage: actions.rawMessage,
        actionProvider: actions.provider,
        actionFrameCount: actions.frames.length
      });
    }

    let lastError: unknown;
    let rawMessage: OpenAIChatMessage | undefined;
    let rawFrameCount = 0;
    let usableFrameCount = 0;
    let formatName: string | undefined;

    for (const format of formats(speakingMotionResponseFormat)) {
      formatName = responseFormatName(format);
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? openAI.model,
          messages: buildParameterMessages(
            request,
            available,
            frameCount,
            generation.frameIntervalSec,
            actions.frames,
            speech,
            generation.maxPromptParameters
          ),
          temperature: request.temperature ?? generation.temperature,
          max_tokens: Math.max(1800, frameCount * 260),
          ...(format ? { response_format: format } : {})
        }, openAI);
        rawMessage = completion.choices[0]?.message;
        const raw = parseJSON(rawMessage?.content ?? "") as RawParameterPlan;
        const rawPlan = raw.parameterPlan ?? raw.parameter_plan ?? raw.frames;
        rawFrameCount = Array.isArray(rawPlan) ? rawPlan.length : 0;
        const parameterPlan = sanitizeParameterPlan(
          rawPlan,
          available,
          frameCount,
          generation.frameIntervalSec,
          generation
        );
        usableFrameCount = parameterPlan.length;
        if (parameterPlan.length !== frameCount) {
          lastError = new Error(
            "LLM returned " + parameterPlan.length + "/" + frameCount + " usable parameter frames"
          );
          continue;
        }
        return {
          parameterPlan,
          provider: "openai-compatible",
          motionPlan: actions.frames.length ? actions.frames : undefined,
          rawMessage,
          rawMotionPlanMessage: actions.rawMessage,
          debug: debug({
            actionProvider: actions.provider,
            actionFrameCount: actions.frames.length,
            rawFrameCount,
            usableRawFrameCount: usableFrameCount,
            finalFrameCount: parameterPlan.length,
            responseFormat: formatName
          })
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) break;
      }
    }

    return vadFacs("parameter_planning_failed", errorText(lastError, "Parameter planning failed"), {
      motionPlan: actions.frames,
      rawMessage,
      rawMotionPlanMessage: actions.rawMessage,
      actionProvider: actions.provider,
      actionFrameCount: actions.frames.length,
      rawFrameCount,
      usableRawFrameCount: usableFrameCount,
      responseFormat: formatName
    });
  }

  private async planActions(
    request: SpeakingMotionPlanRequest,
    available: Record<string, Live2DParameterInfo>,
    frameCount: number,
    generation: ResolvedSpeakingMotionGenerationConfig,
    openAI: OpenAIClientOptions,
    speech: SpeechInstruction
  ): Promise<ActionResult> {
    if (!generation.twoStage) return { frames: [], provider: "disabled" };
    let lastError: unknown;
    let rawMessage: OpenAIChatMessage | undefined;

    for (const format of formats(speakingMotionActionResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? openAI.model,
          messages: buildActionMessages(
            request,
            available,
            frameCount,
            generation.frameIntervalSec,
            speech,
            generation.maxPromptParameters
          ),
          temperature: Math.max(request.temperature ?? generation.temperature, 0.32),
          max_tokens: Math.max(900, frameCount * 150),
          ...(format ? { response_format: format } : {})
        }, openAI);
        rawMessage = completion.choices[0]?.message;
        const raw = parseJSON(rawMessage?.content ?? "") as RawActionPlan;
        const frames = sanitizeActionPlan(raw.motionPlan ?? raw.motion_plan ?? raw.frames, frameCount);
        if (frames.length !== frameCount) {
          lastError = new Error(
            "LLM returned " + frames.length + "/" + frameCount + " semantic action frames"
          );
          continue;
        }
        return { frames, provider: "openai-compatible", rawMessage };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) break;
      }
    }
    return { frames: [], provider: "vad-facs", rawMessage, error: lastError };
  }
}

export function createSoullinkSpeakingMotionPlanner(
  options: SoullinkSpeakingMotionPlannerOptions = {}
): SoullinkSpeakingMotionPlanner {
  return SoullinkSpeakingMotionPlanner.create(options);
}

export function isMouthOrJawOpenParameter(
  id: string,
  info?: Partial<Live2DParameterInfo>
): boolean {
  const identifier = normalize(id + " " + (info?.name ?? ""));
  if (has(identifier, [
    "mouthform", "mouthshape", "lipform", "lipshape", "lippucker", "smile",
    "lipcorner", "lippressor", "liptightener", "lipstretcher", "phoneme", "vowel",
    "嘴型", "口型", "唇形", "微笑", "嘟嘴"
  ])) return false;
  const text = identifier;
  return [
    "mouthopen", "openmouth", "jawopen", "openjaw", "jawdrop", "parammouthopeny",
    "嘴巴开合", "嘴巴张合", "口部开合", "口部张合", "下颚开合", "下巴开合",
    "张嘴", "嘴张开", "张口"
  ].some((hint) => text.includes(normalize(hint)));
}

export function sanitizeSpeakingMotionParameters(
  value: unknown,
  available: Record<string, Live2DParameterInfo>,
  config: SpeakingMotionGenerationConfig = {}
): Live2DParamState {
  if (!value || typeof value !== "object") return {};
  const resolved = resolveSpeakingMotionGenerationConfig(config);
  const result: Live2DParamState = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const info = available[id];
    if (!info || isMouthOrJawOpenParameter(id, info)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    result[id] = tune(id, raw, info, resolved);
  }
  return result;
}

function sanitizeAvailableParameters(value: unknown): Record<string, Live2DParameterInfo> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, Live2DParameterInfo> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const defaults = defaultRange(id);
    const a = finite(record.min, defaults.min);
    const b = finite(record.max, defaults.max);
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    const info: Live2DParameterInfo = {
      name: typeof record.name === "string" ? record.name : id,
      groupId: typeof record.groupId === "string" ? record.groupId : undefined,
      groupName: typeof record.groupName === "string" ? record.groupName : undefined,
      min,
      max,
      default: clamp(finite(record.default, defaults.default), min, max)
    };
    if (!isMouthOrJawOpenParameter(id, info)) result[id] = info;
  }
  return result;
}

function sanitizeParameterPlan(
  value: unknown,
  available: Record<string, Live2DParameterInfo>,
  frameCount: number,
  interval: number,
  generation: ResolvedSpeakingMotionGenerationConfig
): SoullinkParameterBeat[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, frameCount).map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      time: index * interval,
      duration: interval,
      label: text(record.label ?? record.expression, "speaking-parameter-frame"),
      parameters: sanitizeSpeakingMotionParameters(record.parameters, available, generation)
    };
  }).filter((beat) => Object.keys(beat.parameters).length > 0);
}

function sanitizeActionPlan(value: unknown, frameCount: number): SpeakingMotionActionFrame[] {
  if (!Array.isArray(value)) return [];
  const frames = new Map<number, SpeakingMotionActionFrame>();
  value.slice(0, frameCount).forEach((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const frameIndex = clampInteger(finite(record.frameIndex ?? record.frame_index, index), 0, frameCount - 1);
    const action = text(record.action ?? record.label ?? record.expression, "");
    if (!action) return;
    frames.set(frameIndex, {
      frameIndex,
      action: action.slice(0, 120),
      emphasis: typeof record.emphasis === "string" ? record.emphasis.slice(0, 120) : undefined
    });
  });
  return Array.from({ length: frameCount }, (_, index) => frames.get(index))
    .filter((frame): frame is SpeakingMotionActionFrame => Boolean(frame));
}

function buildParameterMessages(
  request: SpeakingMotionPlanRequest,
  available: Record<string, Live2DParameterInfo>,
  frameCount: number,
  interval: number,
  motionPlan: SpeakingMotionActionFrame[],
  speech: SpeechInstruction,
  maxParameters: number
): OpenAIChatMessage[] {
  const descriptions = selectParameters(available, maxParameters).map(([id, info]) => (
    "- " + id + ": " + label(id, info) + ", category=" + group(id, info)
      + ", range[" + info.min + ", " + info.max + "], default=" + info.default
  )).join("\n");
  return [
    {
      role: "system",
      content: [
        "你是 Live2D 连续动作控制器。把语义动作脚本翻译成可执行的模型参数关键帧。",
        "主表情由 VAD/FACS 负责；这里只补充头部、身体、视线和自然的面部或模型细节。",
        "只能使用以下模型真实参数 ID：",
        descriptions,
        "返回 JSON，根字段为 parameterPlan，每帧包含 time、duration、label、parameters。",
        "必须严格输出 " + frameCount + " 帧，数组顺序对应 motionPlan，帧间隔和 duration 均为 " + interval + " 秒。",
        "参数值是绝对目标值并且必须位于真实 range 内。每帧不得为空，动作之间要连贯。",
        "禁止输出 mouth-open 或 jaw-open 类嘴部开合参数，因为 LipSync 独占开合。",
        "MouthForm、smile、pucker、lip shape、嘴型等非开合参数允许使用，绝对不能一并排除。",
        "用户或台词中的眨眼、转头、挥手等显式动作指令优先级最高。",
        "只返回 JSON，不要 markdown 或解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName: request.characterName,
        characterProfile: request.characterProfile,
        speechText: speech.speechTextForMotion,
        userMessage: request.userMessage ?? null,
        explicitMotionDirectives: speech.explicitMotionDirectives,
        durationSec: request.durationSec ?? null,
        intent: request.intent ?? null,
        vad: request.vad ?? null,
        expression: request.expression ?? null,
        frameCount,
        frameIntervalSec: interval,
        motionPlan
      })
    }
  ];
}

function buildActionMessages(
  request: SpeakingMotionPlanRequest,
  available: Record<string, Live2DParameterInfo>,
  frameCount: number,
  interval: number,
  speech: SpeechInstruction,
  maxParameters: number
): OpenAIChatMessage[] {
  const capabilities = capabilitySummary(selectParameters(available, maxParameters));
  return [
    {
      role: "system",
      content: [
        "你是 Live2D 语义动作规划器。先规划连续动作，下一阶段会翻译为真实模型参数。",
        "当前模型能力来自参数与 CDI3 元数据：",
        capabilities,
        "返回 JSON，根字段为 motionPlan，每帧包含 frameIndex、action、emphasis。",
        "严格输出 " + frameCount + " 帧，frameIndex 从 0 连续递增，每帧跨度 " + interval + " 秒。",
        "每个动作应具体、可执行、前后连贯，并组合头身、视线、眉眼、嘴型或模型私有能力。",
        "explicitMotionDirectives 优先级最高，必须在前面的帧中准确执行。",
        "只返回 JSON，不要 markdown 或解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName: request.characterName,
        characterProfile: request.characterProfile,
        speechText: speech.speechTextForMotion,
        userMessage: request.userMessage ?? null,
        explicitMotionDirectives: speech.explicitMotionDirectives,
        durationSec: request.durationSec ?? null,
        intent: request.intent ?? null,
        vad: request.vad ?? null,
        expression: request.expression ?? null,
        frameCount,
        frameIntervalSec: interval
      })
    }
  ];
}

function analyzeSpeech(speechText: string, userMessage?: string): SpeechInstruction {
  const originalSpeechText = speechText ?? "";
  const directives: string[] = [];
  if (looksLikeDirective(userMessage ?? "")) addUnique(directives, (userMessage ?? "").trim().slice(0, 120));
  const speechTextForMotion = originalSpeechText.replace(
    /[（(【\[]([^（）()\[\]【】]{1,120})[）)】\]]/gu,
    (match, content: string) => {
      if (!looksLikeDirective(content)) return match;
      addUnique(directives, content.trim());
      return "";
    }
  ).replace(/\s{2,}/gu, " ").trim();
  return {
    originalSpeechText,
    speechTextForMotion: speechTextForMotion || originalSpeechText,
    explicitMotionDirectives: directives.slice(0, 6)
  };
}

function looksLikeDirective(value: string): boolean {
  const normalized = normalize(value);
  return [
    "wink", "眨眼", "闭眼", "睁眼", "转头", "歪头", "点头", "摇头",
    "挥手", "抬手", "比心", "鞠躬", "看向", "看着", "低头", "抬头"
  ].some((hint) => normalized.includes(hint));
}

function selectParameters(
  available: Record<string, Live2DParameterInfo>,
  max: number
): Array<[string, Live2DParameterInfo]> {
  return Object.entries(available)
    .sort(([a, ai], [b, bi]) => rank(a, ai) - rank(b, bi) || a.localeCompare(b))
    .slice(0, max);
}

function capabilitySummary(parameters: Array<[string, Live2DParameterInfo]>): string {
  const groups = new Map<string, string[]>();
  for (const [id, info] of parameters) {
    const key = group(id, info);
    groups.set(key, [...(groups.get(key) ?? []), label(id, info) + " (" + id + ")"]);
  }
  return [...groups].map(([key, values]) => "- " + key + ": " + values.slice(0, 12).join(", ")).join("\n");
}

function rank(id: string, info: Live2DParameterInfo): number {
  return ["head", "body", "gaze", "brow", "mouthForm", "eyeSmile"].includes(group(id, info)) ? 0 : 10;
}

function group(id: string, info: Live2DParameterInfo): string {
  const value = normalize(id + " " + (info.name ?? "") + " " + (info.groupName ?? ""));
  if (has(value, ["body", "torso", "spine", "身体", "躯干"])) return "body";
  if (has(value, ["angle", "head", "neck", "头", "颈"])) return "head";
  if (has(value, ["eyeball", "gaze", "眼球", "视线"])) return "gaze";
  if (has(value, ["brow", "眉"])) return "brow";
  if (has(value, ["mouthform", "mouthshape", "lipshape", "pucker", "smile", "嘴型", "口型"])) return "mouthForm";
  if (has(value, ["eyesmile", "笑眼"])) return "eyeSmile";
  if (has(value, ["arm", "hand", "ear", "tail", "wing", "手", "耳", "尾", "翅"])) return "appendage";
  return info.groupName || info.groupId || "other";
}

function tune(
  id: string,
  value: number,
  info: Live2DParameterInfo,
  config: ResolvedSpeakingMotionGenerationConfig
): number {
  let next = clamp(value, info.min, info.max);
  const normalized = normalize(id);
  const eyeOpen = normalized.includes("eye") && normalized.includes("open");
  const joint = !eyeOpen && has(normalized, [
    "angle", "body", "head", "neck", "shoulder", "arm", "hand", "wrist",
    "elbow", "spine", "torso", "hip", "leg", "knee", "foot"
  ]);
  if (joint) next = info.default + (next - info.default) * config.jointMotionBoost;
  if (eyeOpen && config.eyeOpenBinary) {
    next = next >= (info.min + info.max) / 2 ? info.max : info.min;
  }
  const range = Math.abs(info.max - info.min);
  const delta = next - info.default;
  const minimum = range * config.minVisibleRatio;
  if (range && Math.abs(delta) > 0 && Math.abs(delta) < minimum) {
    next = info.default + Math.sign(delta) * minimum;
  }
  return clamp(next, info.min, info.max);
}

function defaultRange(id: string): Live2DParameterInfo {
  const value = normalize(id);
  if (value.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (has(value, ["eyeball", "mouthform", "mouthshape", "brow", "pucker", "smile"])) {
    return { min: -1, max: 1, default: 0 };
  }
  if (value.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: 0 };
}

function formats(schema: OpenAIJsonSchemaResponseFormat): Array<OpenAIResponseFormat | undefined> {
  return [schema, { type: "json_object" }, undefined];
}

function responseFormatName(format: OpenAIResponseFormat | undefined): string {
  if (!format) return "none";
  return format.type === "json_schema" ? "json_schema:" + format.json_schema.name : format.type;
}

function parseJSON(content: string): unknown {
  const value = content.trim();
  if (!value) throw new Error("LLM returned empty content");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1)) as unknown;
    throw new Error("LLM did not return JSON: " + value.slice(0, 160));
  }
}

function label(id: string, info: Live2DParameterInfo): string {
  const labels = [info.name, info.groupName].filter((value): value is string => Boolean(value?.trim()));
  return labels.length ? Array.from(new Set(labels)).join(" / ") : id;
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
}

function has(value: string, hints: string[]): boolean {
  return hints.some((hint) => value.includes(normalize(hint)));
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function integer(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampInteger(value, min, max)
    : clampInteger(fallback, min, max);
}

function number(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : error == null ? fallback : String(error);
}

function addUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) values.push(value);
}

const parameterFrameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["time", "duration", "label", "parameters"],
  properties: {
    time: { type: "number", minimum: 0 },
    duration: { type: "number", minimum: 0.1, maximum: 30 },
    label: { type: "string" },
    parameters: {
      type: "object",
      minProperties: 1,
      maxProperties: 12,
      additionalProperties: { type: "number" }
    }
  }
} as const;

const actionFrameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["frameIndex", "action", "emphasis"],
  properties: {
    frameIndex: { type: "number", minimum: 0 },
    action: { type: "string" },
    emphasis: { type: "string" }
  }
} as const;

export const speakingMotionResponseFormat: OpenAIJsonSchemaResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_speaking_parameter_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["parameterPlan"],
      properties: { parameterPlan: { type: "array", items: parameterFrameSchema } }
    }
  }
};

export const speakingMotionActionResponseFormat: OpenAIJsonSchemaResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_speaking_motion_actions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["motionPlan"],
      properties: { motionPlan: { type: "array", items: actionFrameSchema } }
    }
  }
};
