// @soullink-emotion/runtime-core — headless, framework-agnostic orchestrator for
// the Soullink emotion runtime. Wraps @soullink-emotion/engine with injectable
// ports (clock, audio, planner, tts, classifier) so the same session logic runs
// in a browser, in Node, or under test.

export { createSoullinkSession } from "./createSoullinkSession";
export { createRafClock, createIntervalClock, createManualClock } from "./clocks";
export { createBrowserAudioSink } from "./browserAudioSink";
export { amanePersona } from "./presets/amanePersona";

export type {
  RuntimeSnapshot,
  VoiceStatus,
  ConversationTurn,
  PersonaConfig,
  MotionParameterInfo,
  ProactiveDraft,
  ReactionPlanInput,
  ProactivePlanInput,
  ProactivePlanResult,
  ReflectionPlanInput,
  ReflectionPlanResult,
  SpeakingMotionSchedulingMode,
  SpeakingMotionSchedulingConfig,
  SpeakingMotionInput,
  SpeakingMotionResult,
  PlannerClient,
  TtsContext,
  TtsResult,
  TtsClient,
  Clock,
  ClockTickCallback,
  ManualClock,
  AudioSource,
  AudioPlayback,
  AudioSink,
  ClassifyResult,
  MessageClassifier,
  TriggerIntentOptions,
  SessionSnapshot,
  SoullinkSessionOptions,
  SpeakRequest,
  DeliverProactiveOptions,
  SoullinkSession
} from "./types";
