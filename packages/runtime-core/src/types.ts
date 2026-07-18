// Framework-agnostic, DOM-free contracts for the Soullink headless orchestrator.
//
// Nothing here imports from apps/web. The engine (a peer dependency) supplies the
// shared domain types; every host-specific concern (planner HTTP calls, TTS,
// clock, audio playback, message classification) is expressed as an injectable
// port so the same session logic runs in a browser, in Node, or under test.

import type {
  AudioLevelAnalyzer,
  EmotionIntent,
  ModelProfile,
  MotionStyleOptions,
  PartialFACSActionUnitState,
  PartialFACSLikeState,
  RuntimeSnapshot as EngineRuntimeSnapshot,
  SoullinkExternalPlan,
  SoullinkParameterBeat,
  SoullinkProactiveEvent,
  SoullinkReflectionState,
  SoullinkRuntime,
  VADVector
} from "@soullink-emotion/engine";

// Re-export the engine runtime snapshot under the name the session speaks in.
export type { EngineRuntimeSnapshot as RuntimeSnapshot };

export type VoiceStatus = "idle" | "loading" | "playing" | "error";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Character configuration. Kept as plain data so it can be serialized and swapped
 * without touching the orchestration.
 */
export interface PersonaConfig {
  name: string;
  profile: string;
  /** Maps an emotion name to the expression variant used when the character speaks. */
  variantByEmotion: Record<string, string>;
  /** Emotion -> canned reply used when the reaction planner fails. */
  fallbacks?: Record<string, string>;
  /** Emotion -> canned line used when a proactive draft fails to generate. */
  proactiveFallbacks?: Record<string, string>;
}

/** Structural mirror of the renderer's Live2DMotionParameterInfo (no renderer import). */
export interface MotionParameterInfo {
  name?: string;
  groupId?: string;
  groupName?: string;
  min: number;
  max: number;
  default: number;
}

export interface ProactiveDraft {
  eventId: string;
  status: "loading" | "ready" | "error";
  message: string;
  emotion: string;
  reason: string;
  provider: string;
}

// ---- Planner port (modeled after apps/web/src/api/soullinkApi.ts) ----

export interface ReactionPlanInput {
  message: string;
  conversation: ConversationTurn[];
  characterName: string;
  characterProfile: string;
  vad?: Partial<VADVector>;
}

export interface ProactivePlanInput {
  characterName: string;
  characterProfile: string;
  proactive: SoullinkProactiveEvent;
  conversation: ConversationTurn[];
  reflection: SoullinkReflectionState | null;
  vad?: Partial<VADVector>;
}

export interface ProactivePlanResult {
  message: string;
  emotion: string;
  reason: string;
  provider: string;
}

export interface ReflectionPlanInput {
  conversation: ConversationTurn[];
  vad?: Partial<VADVector>;
  topic?: string;
  characterName: string;
  characterProfile: string;
}

export interface ReflectionPlanResult {
  thought: string;
  reason: string;
  emotion?: string;
  vadTarget?: Partial<VADVector>;
}

/**
 * `fixed-parallel` plans a known number of frames while TTS is still running.
 * `duration` waits for TTS so the planner can size the plan from the real clip.
 */
export type SpeakingMotionSchedulingMode = "duration" | "fixed-parallel";

export interface SpeakingMotionSchedulingConfig {
  /** Defaults to `fixed-parallel` for the lowest time-to-first-audio. */
  mode?: SpeakingMotionSchedulingMode;
  /** Number of keyframes requested in `fixed-parallel` mode. Defaults to 4. */
  fixedFrameCount?: number;
  /** Distance between generated keyframes. Defaults to 1 second. */
  frameIntervalSec?: number;
}

export interface SpeakingMotionInput {
  speechText: string;
  durationSec: number;
  /** Scheduling metadata for planners that support both duration-derived and fixed plans. */
  mode?: SpeakingMotionSchedulingMode;
  /** Present in `fixed-parallel` mode; omitted so duration-aware planners can derive it. */
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
  characterName: string;
  characterProfile: string;
  userMessage?: string;
}

export interface SpeakingMotionResult {
  /** Empty or omitted when VAD/FACS should drive expression without parameter keyframes. */
  parameterPlan?: SoullinkParameterBeat[];
  /** `vad-facs` explicitly selects the no-parameter-plan path. */
  provider?: string;
  fallbackReason?: string;
}

export interface PlannerClient {
  planReaction(input: ReactionPlanInput): Promise<SoullinkExternalPlan>;
  planProactive?(input: ProactivePlanInput): Promise<ProactivePlanResult>;
  planReflection?(input: ReflectionPlanInput): Promise<ReflectionPlanResult>;
  planSpeakingMotion?(input: SpeakingMotionInput): Promise<SpeakingMotionResult>;
}

// ---- TTS port ----

export interface TtsContext {
  emotion?: string;
  vad?: Partial<VADVector>;
  intent?: EmotionIntent | null;
}

export interface TtsResult {
  url?: string;
  bytes?: ArrayBuffer;
  durationSec?: number;
}

export interface TtsClient {
  synthesize(text: string, ctx: TtsContext): Promise<TtsResult>;
}

// ---- Clock port ----

export type ClockTickCallback = (now: number, dt: number) => void;

export interface Clock {
  start(cb: ClockTickCallback): void;
  stop(): void;
  /** Best-effort current time in seconds; used for intent timing between ticks. */
  now?(): number;
}

export interface ManualClock extends Clock {
  now(): number;
  tick(now: number, dt: number): void;
}

// ---- Audio port ----

export interface AudioSource {
  url?: string;
  bytes?: ArrayBuffer;
}

/**
 * Result of starting playback. `play` resolves once playback has *started*.
 * `finished` (when provided) resolves when the clip ends, errors, or is stopped,
 * which is what the serial callers await to preserve one-at-a-time speech.
 */
export interface AudioPlayback {
  durationSec: number;
  finished?: Promise<void>;
}

export interface AudioSink {
  play(src: AudioSource): Promise<AudioPlayback>;
  stop(): void;
}

// ---- Classifier port ----

export interface ClassifyResult {
  intent: EmotionIntent;
}

export interface MessageClassifier {
  classify(message: string): Promise<ClassifyResult>;
}

// ---- Session ----

/** Subset of the engine runtime's trigger options the session forwards. */
export interface TriggerIntentOptions {
  seed?: number;
  vadTarget?: Partial<VADVector>;
  vadDelta?: Partial<VADVector>;
  parameterPlan?: SoullinkParameterBeat[];
  replyDraft?: string;
  provider?: string;
}

/** Full session state, emitted on every meaningful change via `onSnapshot`. */
export interface SessionSnapshot {
  runtime: EngineRuntimeSnapshot | null;
  planning: boolean;
  apiError: string | null;
  lastReply: string;
  voiceStatus: VoiceStatus;
  autoVoiceEnabled: boolean;
  proactiveDraft: ProactiveDraft | null;
  conversation: ConversationTurn[];
}

export interface SoullinkSessionOptions {
  profile: ModelProfile;
  persona: PersonaConfig;
  planner?: PlannerClient;
  tts?: TtsClient;
  classifier?: MessageClassifier;
  clock?: Clock;
  audio?: AudioSink;
  onSnapshot?: (snapshot: SessionSnapshot) => void;
  reflectionIdleDelaySeconds?: number;
  speakingMotionScheduling?: SpeakingMotionSchedulingConfig;
  /** Optional local motion variation tuning passed to the engine runtime. */
  motionStyle?: MotionStyleOptions;
  /** Optional measured audio source for RMS lip sync and speech accents. */
  audioLevelAnalyzer?: AudioLevelAnalyzer | null;
}

export interface SpeakRequest {
  text: string;
  emotion?: string;
  vad?: Partial<VADVector>;
  intent?: EmotionIntent | null;
  planSpeakingMotion?: boolean;
  force?: boolean;
  userMessage?: string;
}

export interface DeliverProactiveOptions {
  /** Transform the planned message before it is spoken (e.g. length clamp). */
  transformMessage?: (message: string) => string;
  /** Emotion to fall back to when the planner does not return one. */
  fallbackEmotion?: string;
  /** Prefix for the apiError string set when planning fails. */
  errorLabel?: string;
}

export interface SoullinkSession {
  start(): void;
  stop(): void;
  sendMessage(message: string, options?: { awaitReply?: boolean }): Promise<EmotionIntent | null>;
  triggerIntent(intent: EmotionIntent, options?: TriggerIntentOptions): void;
  acceptProactive(): Promise<void>;
  deliverProactive(event: SoullinkProactiveEvent, options?: DeliverProactiveOptions): Promise<boolean>;
  planProactive(event: SoullinkProactiveEvent): Promise<ProactivePlanResult>;
  pushAssistantTurn(content: string): void;
  requestReflection(topic?: string): Promise<void>;
  synthesizeLastReply(): Promise<void>;
  speak(request: SpeakRequest): Promise<void>;
  stopVoice(): void;
  reset(): void;
  setProfile(profile: ModelProfile): void;
  getSnapshot(): SessionSnapshot;
  getRuntimeSnapshot(): EngineRuntimeSnapshot | null;
  getRuntime(): SoullinkRuntime | null;
  getProfile(): ModelProfile | null;
  setSpeakingMotionParameters(parameters: Record<string, MotionParameterInfo>): void;
  setAutoVoiceEnabled(enabled: boolean): void;
  // Manual / calibration passthroughs to the engine runtime.
  setIdleEnabled(enabled: boolean): void;
  setLipSyncEnabled(enabled: boolean): void;
  setManualFACS(facs: PartialFACSLikeState): void;
  setManualActionUnits(actionUnits: PartialFACSActionUnitState): void;
  setManualParameters(parameters: Record<string, number>): void;
  setParameterGain(gain: number): void;
  setBodyMotionGain(gain: number): void;
  setVADDecayRate(rate: number): void;
  setProactiveRepeatEnabled(enabled: boolean): void;
}
