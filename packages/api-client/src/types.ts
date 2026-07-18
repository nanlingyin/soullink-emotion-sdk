import type {
  AdaptationCoverage,
  EmotionIntent,
  ModelCapabilities,
  ModelProfile,
  PartialFACSLikeState,
  PrivateEmotionMapping,
  SoullinkExternalPlan,
  SoullinkParameterBeat,
  SoullinkProactiveEvent,
  SoullinkReflectionState,
  VADVector
} from "@soullink-emotion/engine";
import type { MotionParameterInfo } from "@soullink-emotion/runtime-core";

export interface SoullinkConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface OpenAIProviderSettings {
  enabled: boolean;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface OpenAIProviderRequestConfig {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  organization?: string;
  project?: string;
  timeoutMs?: number;
}

export interface OpenAIChatMessageDebug {
  role: string;
  content: string;
}

export interface SpeakingMotionActionFrame {
  frameIndex: number;
  action: string;
  emphasis?: string;
}

export interface ReactionPlanRequest {
  message: string;
  conversation?: SoullinkConversationTurn[];
  characterName?: string;
  characterProfile?: string;
  vad?: Partial<VADVector>;
  model?: string;
  temperature?: number;
  openAI?: OpenAIProviderRequestConfig;
}

export interface SpeakingMotionPlanRequest {
  speechText: string;
  durationSec?: number;
  mode?: "duration" | "fixed-parallel";
  frameCount?: number;
  frameIntervalSec?: number;
  availableParameters?: Record<string, MotionParameterInfo>;
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
  openAI?: OpenAIProviderRequestConfig;
}

export interface SpeakingMotionPlan {
  parameterPlan: SoullinkParameterBeat[];
  provider: "openai-compatible" | "vad-facs";
  motionPlan?: SpeakingMotionActionFrame[];
  rawMessage?: OpenAIChatMessageDebug;
  rawMotionPlanMessage?: OpenAIChatMessageDebug;
  debug?: {
    model: string;
    baseURL: string;
    requestedFrameCount: number;
    availableParameterCount: number;
    actionProvider?: "openai-compatible" | "vad-facs" | "disabled";
    actionFrameCount?: number;
    rawFrameCount?: number;
    usableRawFrameCount?: number;
    finalFrameCount: number;
    responseFormat?: string;
    fallbackReason?: string;
    frameIntervalSec: number;
    frameDurationMs: number;
    speechTextForMotion: string;
    explicitMotionDirectives: string[];
    appliedMotionOverrides?: string[];
    jointMotionBoost: number;
    eyeOpenBinary: boolean;
    minVisibleRatio: number;
    elapsedMs: number;
  };
}

export interface ReflectionPlanRequest {
  conversation?: SoullinkConversationTurn[];
  vad?: Partial<VADVector>;
  topic?: string;
  characterName?: string;
  characterProfile?: string;
  model?: string;
  temperature?: number;
  openAI?: OpenAIProviderRequestConfig;
}

export interface ReflectionPlan {
  thought: string;
  reason: string;
  emotion: string;
  vadTarget: VADVector;
  initiativePrompt: string;
  provider: "openai-compatible" | "fallback";
}

export interface ProactiveMessageRequest {
  characterName?: string;
  characterProfile?: string;
  proactive: SoullinkProactiveEvent;
  conversation?: SoullinkConversationTurn[];
  reflection?: SoullinkReflectionState | null;
  vad?: Partial<VADVector>;
  model?: string;
  temperature?: number;
  openAI?: OpenAIProviderRequestConfig;
}

export interface ProactiveMessagePlan {
  message: string;
  emotion: string;
  reason: string;
  provider: "openai-compatible" | "fallback";
}

export type VoiceProvider = "voxcpm2" | "cosyvoice2";
export type VoiceResponseFormat = "mp3" | "opus" | "wav" | "pcm";

export interface VoiceRequest {
  text: string;
  control?: string;
  emotion?: string;
  vad?: Partial<VADVector>;
  provider?: VoiceProvider;
  openAI?: OpenAIProviderRequestConfig;
  cfgValue?: number;
  inferenceTimesteps?: number;
  normalize?: boolean;
  cosyVoiceModel?: string;
  cosyVoiceVoice?: string;
  responseFormat?: VoiceResponseFormat;
  speed?: number;
  gain?: number;
}

export interface CloneVoiceRequest extends Omit<VoiceRequest, "provider"> {
  referenceAudioBase64?: string;
  referenceAudioDataUrl?: string;
  referenceAudioPath?: string;
  referenceAudioMimeType?: string;
  referenceAudioFilename?: string;
  refText?: string;
}

export interface AutoProfileRequest {
  modelDir?: string;
  displayName?: string;
  force?: boolean;
  openAI?: OpenAIProviderRequestConfig;
}

export interface AutoProfileResult {
  generated: boolean;
  reason: "current" | "missing" | "stale" | "forced";
  provider: "openai-compatible" | "heuristic" | "existing" | "manual";
  profileUrl: string;
  modelUrl: string;
  profile: ModelProfile;
  sourceSignature: {
    modelDir: string;
    model3File: string;
    cdi3File?: string;
    hash: string;
    generatedAt: string;
  };
  notes: string[];
  /** Response-only adaptation coverage diagnostic; never written into the profile file. */
  coverage?: AdaptationCoverage;
}

export interface ModelUploadFile extends Blob {
  readonly name?: string;
  readonly lastModified?: number;
  readonly webkitRelativePath?: string;
}

export interface ModelUploadRequest {
  files: readonly ModelUploadFile[];
  modelDir?: string;
  displayName?: string;
  openAI?: OpenAIProviderRequestConfig;
}

export interface ModelUploadResult {
  modelDir: string;
  displayName: string;
  model3File: string;
  fileCount: number;
  totalBytes: number;
  uploadedAs: "files" | "zip" | "mixed";
  profile: AutoProfileResult;
}

export interface ModelSummary {
  modelDir: string;
  displayName: string;
  modelUrl: string;
  profileUrl: string | null;
  hasProfile: boolean;
  version: string | null;
  capabilities: ModelCapabilities | null;
  thumbnailUrl: string | null;
  sourceHash: string | null;
  updatedAt: string | null;
}

export interface CalibrationSaveRequest {
  modelDir: string;
  parameterMap?: Record<string, unknown>;
  customParams?: Record<string, unknown>;
  /** Patch semantics: use `null` to delete an existing private-emotion rule. */
  privateEmotionMap?: Record<string, PrivateEmotionMapping | null>;
  neutralParams?: Record<string, number>;
  idleConfig?: Record<string, [number, number]>;
  displayName?: string;
}

export interface EmbeddingClassifyResponse {
  intent: EmotionIntent;
  initialized: boolean;
  exampleCount: number;
}

export interface EmbeddingConfig {
  configured: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
  classifierInitialized: boolean;
  exampleCount: number;
}

export interface TtsProviderConfig {
  configured: boolean;
  baseURL?: string;
  timeoutMs?: number;
  [key: string]: unknown;
}

export interface TtsConfig extends TtsProviderConfig {
  providers?: {
    voxcpm2: TtsProviderConfig;
    cosyvoice2: TtsProviderConfig;
  };
}

export interface HealthResponse {
  ok: boolean;
  service: string;
}

export type ReactionPlan = SoullinkExternalPlan;
