// Curated public API for @soullink-emotion/engine.
//
// This is the stable, supported surface of the engine. Every symbol here is an
// intentional entry point. It is a strict subset of the full internal surface
// (see ./internal), and re-exports at minimum everything the first-party apps
// (apps/web, apps/api) consume from the package root.
//
// Need something not listed here? Reach the full, unstable surface via the deep
// import "@soullink-emotion/engine/internal".

// ---- Values (classes / functions / constants) ----
export {
  // Runtime orchestrator
  SoullinkRuntime,
  // Reaction / message classification
  MessageReactionClassifier,
  // Emotion / VAD presets
  getVADPreset,
  emotionVADPresets,
  // FACS / action units
  actionUnitDefinitions,
  actionUnitKeys,
  facsKeys,
  // Model profile loading / capabilities / derivation
  loadModelProfile,
  detectCapabilities,
  deriveNeutralParams,
  deriveParameterSmoothing,
  computeAdaptationCoverage,
  isStandardId,
  CURRENT_SCHEMA_VERSION,
  // Native animation resolver (C5)
  resolveNativeAnimation,
  motionStylePresets,
  IdleActionScheduler,
  // Math utils
  clamp,
} from "./internal";

// ---- Types ----
export type {
  // Emotion / reaction
  EmotionIntent,
  VADVector,
  // FACS state
  FACSKey,
  PartialFACSLikeState,
  PartialFACSActionUnitState,
  // Model profile
  ModelProfile,
  ModelCapabilities,
  ParameterMap,
  ParameterMapRule,
  ParameterBlendMode,
  PrivateEmotionCategory,
  PrivateEmotionVADRange,
  PrivateEmotionMapping,
  PrivateEmotionMap,
  MappingSource,
  AdaptationCoverage,
  NativeExpressionEntry,
  NativeMotionEntry,
  NativeAnimationCatalog,
  NativeMotionPriority,
  ExpressionBinding,
  MotionBinding,
  NativeAnimationDirective,
  // Live2D parameter state
  Live2DParamState,
  // Reaction plan surface
  SoullinkExternalPlan,
  SoullinkParameterBeat,
  SoullinkProactiveEvent,
  SoullinkReflectionState,
  // Runtime snapshot
  RuntimeSnapshot,
  SoullinkRuntimeOptions,
  MotionStyleOptions,
  ResolvedMotionStyle,
  MotionStylePresetName,
  IdleActionSchedulerOptions,
  IdleActionUpdateContext,
  IdleActionSchedulerState,
  IdleActionLabel,
  AudioLevelAnalyzer,
} from "./internal";
