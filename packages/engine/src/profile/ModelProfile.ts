import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";

export interface NativeExpressionEntry {
  name: string;
  file: string;
  params?: string[];  // param ids that this expression sets, discovered from exp3 content
}

export interface NativeMotionEntry {
  group: string;
  index: number;
  file: string;
}

export interface NativeAnimationCatalog {
  expressions?: NativeExpressionEntry[];
  motions?: NativeMotionEntry[];
}

export type NativeMotionPriority = "idle" | "normal" | "force";

export interface ExpressionBinding {
  expression: string;
  minIntensity?: number;
}

export interface MotionBinding {
  group: string;
  index?: number;
  priority?: NativeMotionPriority;
}

export interface NativeAnimationDirective {
  token: number;
  expression: string | null;
  motion: MotionBinding | null;
  suppressParamIds: string[];
}

export type ParameterBlendMode = "set" | "add" | "subtract" | "inverse";

export interface ParameterMapRule {
  target?: string;
  targets?: string[];
  mode?: ParameterBlendMode;
  scale?: number;
  offset?: number;
  min?: number;
  max?: number;
  // v2 expressive transform fields (optional; ignored when schemaVersion < 2)
  curve?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "smoothstep";
  gamma?: number;
  deadzone?: number;
  inputRange?: [number, number];
  outputRange?: [number, number];
  invertAround?: number;
}

export type ParameterMap = Partial<Record<FACSKey, ParameterMapRule>>;

export type PrivateEmotionCategory =
  | "positiveEye"
  | "blush"
  | "tear"
  | "shadow"
  | "anger"
  | "sweat"
  | "surprise"
  | "privateEffect";

export interface PrivateEmotionVADRange {
  valence?: [number, number];
  arousal?: [number, number];
  dominance?: [number, number];
}

export interface PrivateEmotionMapping {
  target?: string;
  targets?: string[];
  /** Built-in VAD response curve used when no explicit trigger is supplied. */
  category?: PrivateEmotionCategory;
  /** Dominant-emotion names that activate this mapping. */
  emotions?: string[];
  /** Optional inclusive VAD activation window. */
  vadRange?: PrivateEmotionVADRange;
  triggerMode?: "any" | "all";
  activeValue?: number;
  neutralValue?: number;
  intensity?: number;
  /** Higher values win within the same exclusive group. */
  priority?: number;
  exclusiveGroup?: string;
  source?: "heuristic" | "llm" | "manual";
  confidence?: number;
}

export type PrivateEmotionMap = Record<string, PrivateEmotionMapping>;

export interface ModelCapabilities {
  headControl: boolean;
  bodyControl: boolean;
  eyeBlink: boolean;
  eyeSmile: boolean;
  gazeControl: boolean;
  mouthOpen: boolean;
  mouthSmile: boolean;
  browControl: boolean;
  blush: boolean;
  tear: boolean;
  sweat: boolean;
  breath: boolean;
}

export interface ModelProfile {
  modelId: string;
  displayName: string;
  version: string;
  modelPath: string;
  sourceSignature?: {
    modelDir?: string;
    model3File?: string;
    cdi3File?: string;
    hash: string;
    generatedAt?: string;
  };
  autoProfile?: {
    provider: "openai-compatible" | "heuristic" | "existing" | "manual";
    promptVersion?: string;
    generatedAt?: string;
    notes?: string[];
  };
  schemaVersion?: number;
  capabilities?: ModelCapabilities;
  parameterMap: ParameterMap;
  customParams?: Record<string, ParameterMapRule>;
  privateEmotionMap?: PrivateEmotionMap;
  idleConfig: Partial<Record<FACSKey, [number, number]>>;
  reactionBias?: Record<string, Record<string, number>>;
  neutralParams?: Record<string, number>;
  parameterSmoothing?: Record<string, number>;
  nativeAnimations?: NativeAnimationCatalog;
  expressionMap?: Record<string, ExpressionBinding | string>;
  motionMap?: Record<string, MotionBinding>;
}

export interface ProfileLoadResult {
  profile: ModelProfile;
  sourceUrl: string;
}

export type ProfileFallback = (facs: PartialFACSLikeState, profile: ModelProfile) => PartialFACSLikeState;
