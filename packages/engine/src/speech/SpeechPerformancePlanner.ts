import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";
import { clampFACSState } from "../facs/FACSUtils";
import { emotionVADPresets, neutralVAD } from "../emotion/EmotionPresetRegistry";
import type { VADVector } from "../emotion/VADState";
import type { ModelProfile } from "../profile/ModelProfile";
import { clamp } from "../utils/clamp";
import { ease, type EasingName } from "../utils/easing";
import { seededRandom, type RandomSource } from "../utils/seededRandom";

export type SpeechGestureChannel =
  | "headX"
  | "headY"
  | "headZ"
  | "bodyX"
  | "bodyY"
  | "bodyZ"
  | "gazeX"
  | "gazeY";

export type SpeechExpressionChannel =
  | "browInnerUp"
  | "browOuterUp"
  | "browDown"
  | "eyeSquint"
  | "eyeSmile"
  | "mouthSmile"
  | "mouthFrown"
  | "mouthPucker"
  | "blush"
  | "tear"
  | "sweat";

export const speechGestureChannels: readonly SpeechGestureChannel[] = [
  "headX", "headY", "headZ", "bodyX", "bodyY", "bodyZ", "gazeX", "gazeY"
];

export const speechExpressionChannels: readonly SpeechExpressionChannel[] = [
  "browInnerUp", "browOuterUp", "browDown", "eyeSquint", "eyeSmile",
  "mouthSmile", "mouthFrown", "mouthPucker", "blush", "tear", "sweat"
];

export const speechPerformanceSemanticChannels = Object.freeze({
  speechGesture: speechGestureChannels,
  expressionAccent: speechExpressionChannels,
  mouthSync: ["mouthOpen"] as const,
  idleMotion: ["breath", "eyeBlinkL", "eyeBlinkR"] as const
});

export interface SpeechPerformanceCurveFrame {
  at: number;
  value: number;
  easing?: EasingName;
}

export interface SpeechPerformanceCurve {
  range: [number, number];
  maxNormalizedVelocity: number;
  keyframes: readonly SpeechPerformanceCurveFrame[];
}

export type SpeechPerformanceCurveId =
  | "softPulse"
  | "quickAttackSlowRelease"
  | "slowAttackQuickRelease"
  | "anticipationAccent"
  | "overshootSettle"
  | "dampedSpring"
  | "doublePulse"
  | "holdAndRelease";

const frame = (at: number, value: number, easingName: EasingName = "easeInOut"): SpeechPerformanceCurveFrame => ({
  at,
  value,
  easing: easingName
});

const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
};

export const SPEECH_PERFORMANCE_CURVES: Readonly<Record<SpeechPerformanceCurveId, SpeechPerformanceCurve>> = deepFreeze({
  softPulse: {
    range: [0, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.2, 0.32, "easeOut"), frame(0.5, 1), frame(0.8, 0.32), frame(1, 0)]
  },
  quickAttackSlowRelease: {
    range: [0, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.14, 1, "easeOut"), frame(0.46, 0.66), frame(0.78, 0.22), frame(1, 0)]
  },
  slowAttackQuickRelease: {
    range: [0, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.34, 0.35, "easeIn"), frame(0.72, 1), frame(1, 0, "easeIn")]
  },
  anticipationAccent: {
    range: [-0.2, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.14, -0.16, "easeOut"), frame(0.36, 1, "easeOut"), frame(0.68, 0.38), frame(1, 0)]
  },
  overshootSettle: {
    range: [0, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.2, 1, "easeOut"), frame(0.42, 0.43), frame(0.62, 0.69), frame(0.82, 0.28), frame(1, 0)]
  },
  dampedSpring: {
    range: [-0.12, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.16, 1, "easeOut"), frame(0.34, 0.29), frame(0.5, 0.67), frame(0.67, 0.18), frame(0.82, 0.34), frame(1, 0)]
  },
  doublePulse: {
    range: [0, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.2, 0.86, "easeOut"), frame(0.4, 0.08), frame(0.62, 1, "easeOut"), frame(0.82, 0.22), frame(1, 0)]
  },
  holdAndRelease: {
    range: [0, 1],
    maxNormalizedVelocity: 20,
    keyframes: [frame(0, 0), frame(0.22, 0.9, "easeOut"), frame(0.56, 0.9, "linear"), frame(0.78, 0.44), frame(1, 0)]
  }
});

export function sampleSpeechPerformanceCurve(curveId: SpeechPerformanceCurveId, progress: number): number {
  const curve = SPEECH_PERFORMANCE_CURVES[curveId];
  const t = clamp(progress, 0, 1);
  const frames = curve.keyframes;
  if (t <= frames[0].at) return frames[0].value;
  if (t >= frames[frames.length - 1].at) return frames[frames.length - 1].value;

  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    if (t > right.at) continue;
    const left = frames[index - 1];
    const span = Math.max(0.0001, right.at - left.at);
    const local = clamp((t - left.at) / span, 0, 1);
    return left.value + (right.value - left.value) * ease(right.easing ?? "easeInOut", local);
  }

  return 0;
}

export interface SpeechGestureTemplate {
  family: string;
  curveId: SpeechPerformanceCurveId;
  compatibleCurveIds: readonly SpeechPerformanceCurveId[];
  emotions: readonly string[];
  vad: readonly [number, number, number];
  durationRatio: number;
  durationBoundsMs: readonly [number, number];
  amplitudeBounds: readonly [number, number];
  cooldownGroup: string;
  semanticCues: readonly string[];
  deliveryHints: readonly string[];
  lateral?: boolean;
  channels: Readonly<Partial<Record<SpeechGestureChannel, number>>>;
}

const FAMILY_METADATA: Record<string, { semanticCues: string[]; deliveryHints: string[] }> = {
  acknowledgement: { semanticCues: ["agreement", "reassurance"], deliveryHints: ["acknowledge", "reassure"] },
  inquiry: { semanticCues: ["question", "reflection"], deliveryHints: ["ask", "reflect"] },
  uncertainty: { semanticCues: ["uncertainty", "question"], deliveryHints: ["hesitate", "ask"] },
  warmth: { semanticCues: ["affection", "reassurance"], deliveryHints: ["confide", "reassure"] },
  emphasis: { semanticCues: ["emphasis", "contrast", "agreement"], deliveryHints: ["emphasize", "celebrate"] },
  tension: { semanticCues: ["surprise", "tension", "contrast"], deliveryHints: ["warn", "emphasize"] },
  settle: { semanticCues: ["sadness", "reflection", "reassurance"], deliveryHints: ["reflect", "reassure"] },
  transition: { semanticCues: ["reflection"], deliveryHints: ["reflect"] }
};

interface GestureTemplateInput {
  family: string;
  curveId: SpeechPerformanceCurveId;
  emotions: string[];
  vad: [number, number, number];
  durationRatio: number;
  channels: Partial<Record<SpeechGestureChannel, number>>;
  minSegmentMs?: number;
  maxSegmentMs?: number;
  lateral?: boolean;
  cooldownGroup?: string;
  semanticCues?: string[];
  deliveryHints?: string[];
}

const template = (input: GestureTemplateInput): SpeechGestureTemplate => {
  const values = Object.values(input.channels);
  const maxAmplitude = Math.max(...values.map((value) => Math.abs(value ?? 0)), 0);
  const metadata = FAMILY_METADATA[input.family] ?? { semanticCues: [], deliveryHints: [] };
  return {
    ...input,
    compatibleCurveIds: [input.curveId],
    durationBoundsMs: [input.minSegmentMs ?? 650, input.maxSegmentMs ?? 120000],
    amplitudeBounds: [-maxAmplitude, maxAmplitude],
    cooldownGroup: input.cooldownGroup ?? input.family,
    semanticCues: input.semanticCues ?? metadata.semanticCues,
    deliveryHints: input.deliveryHints ?? metadata.deliveryHints
  };
};

export const SPEECH_GESTURE_TEMPLATES: Readonly<Record<string, SpeechGestureTemplate>> = deepFreeze({
  softNod: template({ family: "acknowledgement", curveId: "softPulse", emotions: ["happy", "calm", "affectionate", "shy"], vad: [0.45, -0.1, 0.15], durationRatio: 0.2, channels: { headY: 0.3, bodyY: 0.07 } }),
  doubleNod: template({ family: "acknowledgement", curveId: "doublePulse", emotions: ["happy", "excited", "concerned"], vad: [0.35, 0.45, 0.2], durationRatio: 0.32, minSegmentMs: 1500, channels: { headY: 0.27, bodyY: 0.06 } }),
  reassuringNod: template({ family: "acknowledgement", curveId: "holdAndRelease", emotions: ["affectionate", "concerned", "calm"], vad: [0.5, -0.28, 0.3], durationRatio: 0.27, channels: { headY: 0.23, bodyY: 0.08, gazeY: -0.04 } }),
  curiousTilt: template({ family: "inquiry", curveId: "slowAttackQuickRelease", emotions: ["curious", "surprised"], vad: [0.18, 0.25, 0], durationRatio: 0.3, lateral: true, channels: { headZ: 0.3, headX: 0.09, gazeX: 0.08 } }),
  thoughtfulTilt: template({ family: "inquiry", curveId: "softPulse", emotions: ["curious", "calm", "concerned", "confused"], vad: [0.05, -0.2, -0.05], durationRatio: 0.34, lateral: true, channels: { headZ: 0.22, headY: -0.08, gazeX: 0.12, gazeY: 0.06 } }),
  shyTurn: template({ family: "uncertainty", curveId: "slowAttackQuickRelease", emotions: ["shy", "affectionate", "fearful", "happy"], vad: [0.35, -0.08, -0.35], durationRatio: 0.32, lateral: true, channels: { headX: 0.24, headZ: 0.12, bodyX: 0.08, gazeX: -0.12 } }),
  gentleSway: template({ family: "warmth", curveId: "softPulse", emotions: ["calm", "affectionate", "happy"], vad: [0.45, -0.35, 0], durationRatio: 0.4, minSegmentMs: 1300, lateral: true, channels: { headZ: 0.13, bodyZ: 0.16, bodyX: 0.08 } }),
  affectionateLean: template({ family: "warmth", curveId: "holdAndRelease", emotions: ["affectionate", "happy"], vad: [0.72, -0.08, 0.05], durationRatio: 0.36, lateral: true, channels: { headZ: 0.2, headY: 0.08, bodyY: 0.12, bodyZ: 0.08, gazeY: -0.04 } }),
  forwardEmphasis: template({ family: "emphasis", curveId: "quickAttackSlowRelease", emotions: ["excited", "anger", "happy"], vad: [0.08, 0.68, 0.42], durationRatio: 0.19, channels: { headY: 0.22, bodyY: 0.2, gazeY: -0.05 } }),
  backwardRecoil: template({ family: "tension", curveId: "anticipationAccent", emotions: ["surprised", "anxiety", "fearful", "disgusted"], vad: [-0.32, 0.68, -0.4], durationRatio: 0.22, channels: { headY: -0.19, bodyY: -0.2, gazeY: 0.08 } }),
  delightedLift: template({ family: "emphasis", curveId: "overshootSettle", emotions: ["happy", "excited", "surprised"], vad: [0.75, 0.58, 0.28], durationRatio: 0.24, channels: { headY: -0.2, bodyY: -0.08, gazeY: 0.1 } }),
  delightedBounce: template({ family: "emphasis", curveId: "dampedSpring", emotions: ["excited", "happy"], vad: [0.72, 0.82, 0.38], durationRatio: 0.3, minSegmentMs: 1100, channels: { headY: 0.24, bodyY: 0.14 } }),
  concernedDip: template({ family: "settle", curveId: "slowAttackQuickRelease", emotions: ["concerned", "anxiety", "tired", "sad", "fearful"], vad: [-0.35, -0.22, -0.3], durationRatio: 0.32, lateral: true, channels: { headY: 0.18, headZ: 0.1, bodyY: 0.09, gazeY: -0.08 } }),
  sadSettle: template({ family: "settle", curveId: "holdAndRelease", emotions: ["sad", "tired", "concerned"], vad: [-0.62, -0.5, -0.42], durationRatio: 0.42, minSegmentMs: 1200, channels: { headY: 0.22, bodyY: 0.13, gazeY: -0.1 } }),
  resoluteSet: template({ family: "emphasis", curveId: "overshootSettle", emotions: ["anger", "concerned", "calm"], vad: [-0.08, 0.18, 0.72], durationRatio: 0.27, channels: { headY: 0.12, bodyY: 0.14, gazeY: -0.04 } }),
  angryAccent: template({ family: "emphasis", curveId: "quickAttackSlowRelease", emotions: ["anger", "disgusted"], vad: [-0.72, 0.72, 0.6], durationRatio: 0.18, lateral: true, channels: { headX: 0.18, headY: 0.16, bodyX: 0.15, bodyY: 0.1 } }),
  surpriseRecoil: template({ family: "tension", curveId: "dampedSpring", emotions: ["surprised", "fearful"], vad: [0.02, 0.9, -0.18], durationRatio: 0.2, channels: { headY: -0.24, bodyY: -0.17, gazeY: 0.11 } }),
  questionLift: template({ family: "inquiry", curveId: "anticipationAccent", emotions: ["curious", "confused", "surprised", "concerned"], vad: [0.15, 0.36, -0.08], durationRatio: 0.26, lateral: true, channels: { headZ: 0.22, headY: -0.1, gazeX: 0.07, gazeY: 0.07 } }),
  gazeAccent: template({ family: "uncertainty", curveId: "quickAttackSlowRelease", emotions: ["curious", "confused", "anxiety", "disgusted", "fearful"], vad: [-0.05, 0.38, -0.15], durationRatio: 0.18, lateral: true, channels: { headX: 0.08, gazeX: 0.22, gazeY: 0.05 } }),
  calmDrift: template({ family: "transition", curveId: "softPulse", emotions: ["calm", "tired", "sad", "affectionate"], vad: [0.25, -0.65, 0.05], durationRatio: 0.45, minSegmentMs: 1700, lateral: true, channels: { headX: 0.09, headZ: 0.08, bodyX: 0.08, bodyZ: 0.1, gazeX: 0.05 } }),
  playfulPeek: template({ family: "warmth", curveId: "doublePulse", emotions: ["happy", "curious", "affectionate"], vad: [0.68, 0.5, 0.05], durationRatio: 0.36, minSegmentMs: 1500, lateral: true, channels: { headX: 0.18, headZ: 0.16, bodyX: 0.09, gazeX: -0.14 } }),
  energeticBeat: template({ family: "emphasis", curveId: "doublePulse", emotions: ["excited", "anger", "surprised"], vad: [0.15, 0.9, 0.45], durationRatio: 0.3, minSegmentMs: 1400, channels: { headY: 0.23, bodyY: 0.16, gazeY: -0.05 } })
});

export const SUPPORTED_SPEECH_PERFORMANCE_EMOTIONS = Object.freeze([
  "neutral", "happy", "sad", "anger", "fearful", "surprised", "disgusted", "calm",
  "excited", "affectionate", "shy", "curious", "concerned", "tired", "anxiety", "confused"
]);

export interface SpeechPerformanceExpressionVariant {
  id: string;
  facs: Readonly<Partial<Record<SpeechExpressionChannel, number>>>;
  gestureAffinity: readonly string[];
}

const expression = (
  id: string,
  facs: Partial<Record<SpeechExpressionChannel, number>>,
  gestureAffinity: string[]
): SpeechPerformanceExpressionVariant => ({ id, facs, gestureAffinity });

export const SPEECH_EXPRESSION_VARIANTS: Readonly<Record<string, readonly SpeechPerformanceExpressionVariant[]>> = deepFreeze({
  neutral: [
    expression("neutral-soft", { eyeSquint: 0.03, mouthSmile: 0.02 }, ["calmDrift", "softNod"]),
    expression("neutral-attentive", { browOuterUp: 0.06, eyeSmile: 0.04 }, ["gazeAccent", "thoughtfulTilt"]),
    expression("neutral-warm", { mouthSmile: 0.08, eyeSmile: 0.05 }, ["softNod", "gentleSway"])
  ],
  happy: [
    expression("happy-soft", { mouthSmile: 0.42, eyeSmile: 0.2, eyeSquint: 0.08 }, ["softNod", "gentleSway"]),
    expression("happy-bright", { mouthSmile: 0.58, eyeSmile: 0.3, eyeSquint: 0.16, browOuterUp: 0.1 }, ["delightedLift", "doubleNod"]),
    expression("happy-playful", { mouthSmile: 0.5, eyeSmile: 0.22, browOuterUp: 0.14, mouthPucker: 0.04 }, ["playfulPeek", "curiousTilt"])
  ],
  sad: [
    expression("sad-soft", { browInnerUp: 0.34, mouthFrown: 0.26, eyeSquint: 0.06 }, ["sadSettle", "concernedDip"]),
    expression("sad-held", { browInnerUp: 0.26, mouthFrown: 0.16, eyeSquint: 0.12 }, ["sadSettle", "calmDrift"]),
    expression("sad-vulnerable", { browInnerUp: 0.46, browOuterUp: 0.1, mouthFrown: 0.32, tear: 0.24 }, ["concernedDip", "shyTurn"])
  ],
  anger: [
    expression("anger-focused", { browDown: 0.48, eyeSquint: 0.16, mouthFrown: 0.08 }, ["resoluteSet", "angryAccent"]),
    expression("anger-sharp", { browDown: 0.62, browOuterUp: 0.06, mouthFrown: 0.14 }, ["angryAccent", "forwardEmphasis"]),
    expression("anger-restrained", { browDown: 0.36, eyeSquint: 0.12, mouthFrown: 0.2 }, ["resoluteSet", "gazeAccent"])
  ],
  fearful: [
    expression("fearful-alert", { browInnerUp: 0.42, browOuterUp: 0.3, mouthFrown: 0.1, sweat: 0.2 }, ["backwardRecoil", "gazeAccent"]),
    expression("fearful-uncertain", { browInnerUp: 0.34, mouthFrown: 0.16, eyeSquint: 0.04 }, ["shyTurn", "concernedDip"]),
    expression("fearful-held", { browInnerUp: 0.26, browOuterUp: 0.18, mouthFrown: 0.08, sweat: 0.14 }, ["resoluteSet", "backwardRecoil"])
  ],
  surprised: [
    expression("surprised-open", { browInnerUp: 0.24, browOuterUp: 0.44, mouthPucker: 0.1 }, ["surpriseRecoil", "delightedLift"]),
    expression("surprised-delighted", { browOuterUp: 0.36, eyeSmile: 0.16, mouthSmile: 0.26 }, ["delightedBounce", "questionLift"]),
    expression("surprised-curious", { browOuterUp: 0.3, browInnerUp: 0.1, mouthPucker: 0.06 }, ["curiousTilt", "questionLift"])
  ],
  disgusted: [
    expression("disgusted-wince", { browDown: 0.18, eyeSquint: 0.24, mouthFrown: 0.24 }, ["backwardRecoil", "gazeAccent"]),
    expression("disgusted-skeptical", { browDown: 0.26, eyeSquint: 0.16, mouthFrown: 0.12 }, ["angryAccent", "curiousTilt"]),
    expression("disgusted-contained", { browDown: 0.16, eyeSquint: 0.1, mouthFrown: 0.2 }, ["resoluteSet", "backwardRecoil"])
  ],
  calm: [
    expression("calm-resting", { eyeSquint: 0.1, mouthSmile: 0.08, eyeSmile: 0.03 }, ["calmDrift", "gentleSway"]),
    expression("calm-present", { browOuterUp: 0.05, eyeSquint: 0.05, mouthSmile: 0.12 }, ["reassuringNod", "softNod"]),
    expression("calm-content", { eyeSquint: 0.14, eyeSmile: 0.06, mouthSmile: 0.18 }, ["gentleSway", "affectionateLean"])
  ],
  excited: [
    expression("excited-bright", { browOuterUp: 0.28, eyeSmile: 0.3, mouthSmile: 0.54 }, ["delightedBounce", "energeticBeat"]),
    expression("excited-eager", { browInnerUp: 0.1, browOuterUp: 0.34, mouthSmile: 0.42 }, ["forwardEmphasis", "doubleNod"]),
    expression("excited-playful", { browOuterUp: 0.2, eyeSmile: 0.24, mouthSmile: 0.5, mouthPucker: 0.04 }, ["playfulPeek", "energeticBeat"])
  ],
  affectionate: [
    expression("affectionate-warm", { mouthSmile: 0.34, eyeSmile: 0.18, eyeSquint: 0.14, browInnerUp: 0.06 }, ["affectionateLean", "gentleSway"]),
    expression("affectionate-tender", { mouthSmile: 0.24, eyeSmile: 0.24, eyeSquint: 0.2, browInnerUp: 0.12 }, ["reassuringNod", "affectionateLean"]),
    expression("affectionate-shy", { mouthSmile: 0.28, eyeSmile: 0.2, eyeSquint: 0.1, blush: 0.22 }, ["shyTurn", "softNod"])
  ],
  shy: [
    expression("shy-soft", { mouthSmile: 0.2, eyeSmile: 0.12, eyeSquint: 0.12 }, ["shyTurn", "softNod"]),
    expression("shy-flustered", { browInnerUp: 0.16, eyeSmile: 0.22, mouthSmile: 0.25, blush: 0.3 }, ["shyTurn", "affectionateLean"]),
    expression("shy-warm", { browInnerUp: 0.06, eyeSquint: 0.18, eyeSmile: 0.16, mouthSmile: 0.3 }, ["gentleSway", "shyTurn"])
  ],
  curious: [
    expression("curious-focused", { browOuterUp: 0.24, mouthPucker: 0.04 }, ["curiousTilt", "gazeAccent"]),
    expression("curious-wondering", { browInnerUp: 0.12, browOuterUp: 0.2, mouthPucker: 0.08 }, ["questionLift", "thoughtfulTilt"]),
    expression("curious-playful", { browOuterUp: 0.18, eyeSmile: 0.04, mouthSmile: 0.16 }, ["playfulPeek", "curiousTilt"])
  ],
  concerned: [
    expression("concerned-gentle", { browInnerUp: 0.3, mouthFrown: 0.1, eyeSquint: 0.04 }, ["concernedDip", "reassuringNod"]),
    expression("concerned-attentive", { browInnerUp: 0.22, browOuterUp: 0.1, mouthFrown: 0.06 }, ["thoughtfulTilt", "gazeAccent"]),
    expression("concerned-serious", { browInnerUp: 0.18, browDown: 0.1, mouthFrown: 0.16 }, ["resoluteSet", "concernedDip"])
  ],
  tired: [
    expression("tired-soft", { eyeSquint: 0.26, browInnerUp: 0.06, mouthFrown: 0.08 }, ["calmDrift", "sadSettle"]),
    expression("tired-weary", { eyeSquint: 0.34, browInnerUp: 0.12, mouthFrown: 0.12 }, ["sadSettle", "concernedDip"]),
    expression("tired-content", { eyeSquint: 0.3, eyeSmile: 0.06, mouthSmile: 0.1 }, ["calmDrift", "gentleSway"])
  ],
  anxiety: [
    expression("anxiety-alert", { browInnerUp: 0.34, browOuterUp: 0.16, mouthFrown: 0.14, sweat: 0.28 }, ["gazeAccent", "backwardRecoil"]),
    expression("anxiety-uncertain", { browInnerUp: 0.28, mouthFrown: 0.14, eyeSquint: 0.04 }, ["concernedDip", "shyTurn"]),
    expression("anxiety-contained", { browInnerUp: 0.18, browDown: 0.06, eyeSquint: 0.06, mouthFrown: 0.18 }, ["resoluteSet", "thoughtfulTilt"])
  ],
  confused: [
    expression("confused-questioning", { browInnerUp: 0.1, browOuterUp: 0.24, mouthPucker: 0.06 }, ["questionLift", "curiousTilt"]),
    expression("confused-focused", { browDown: 0.12, browOuterUp: 0.14, eyeSquint: 0.1 }, ["thoughtfulTilt", "gazeAccent"]),
    expression("confused-uncertain", { browInnerUp: 0.2, browOuterUp: 0.1, mouthFrown: 0.08 }, ["concernedDip", "questionLift"])
  ]
});

export interface SpeechPerformanceMotionBudget {
  maxSimultaneousAxes?: number;
  maxMotionDensity?: number;
  minRestWindowMs?: number;
  usedMotionDensity?: number;
  maxSimultaneousAxesUsed?: number;
}

export type SpeechPerformancePlanToken = number;

export interface SpeechPerformanceCapabilities {
  enabled?: boolean;
  gestureChannels?: readonly SpeechGestureChannel[];
  expressionChannels?: readonly SpeechExpressionChannel[];
  channelScales?: Partial<Record<SpeechGestureChannel, number>>;
  maxGestureAmplitude?: number;
  gestureAmplitudeGain?: number;
  gestureLimit?: number;
  performanceTier?: "low" | "medium" | "high";
  reducedMotion?: boolean;
  motionBudget?: SpeechPerformanceMotionBudget;
}

interface ResolvedSpeechPerformanceCapabilities {
  enabled: boolean;
  gestureChannels: Set<SpeechGestureChannel>;
  expressionChannels: Set<SpeechExpressionChannel>;
  channelScales: Partial<Record<SpeechGestureChannel, number>>;
  maxGestureAmplitude: number;
  gestureAmplitudeGain: number;
  gestureLimit: number;
  scale: number;
  motionBudget: Required<Pick<SpeechPerformanceMotionBudget, "maxSimultaneousAxes" | "maxMotionDensity" | "minRestWindowMs">>;
}

export interface SpeechPerformancePlanInput {
  emotion?: string;
  vad?: Partial<VADVector>;
  intensity?: number;
  confidence?: number;
  emotionConfidence?: number;
  durationMs?: number;
  semanticCues?: readonly string[];
  deliveryHints?: readonly string[] | string;
  currentPosture?: Partial<Record<SpeechGestureChannel, number>>;
  history?: readonly SpeechPerformanceHistoryEntry[];
  audioPeaks?: readonly (number | { ratio?: number; timeRatio?: number; timeMs?: number; strength?: number; energy?: number })[];
  turnOrdinal?: number;
  segmentOrdinal?: number;
  revision?: number;
  lifecycleToken?: SpeechPerformancePlanToken;
  seed?: number;
  capabilities?: SpeechPerformanceCapabilities;
}

export interface SpeechPerformanceGesture {
  id: string;
  templateId: string;
  family: string;
  cooldownGroup: string;
  curveId: SpeechPerformanceCurveId;
  startMs: number;
  durationMs: number;
  peakMs: number;
  restBeforeMs: number;
  direction: -1 | 1;
  channels: Partial<Record<SpeechGestureChannel, number>>;
  channelTimings?: Partial<Record<SpeechGestureChannel, { offsetMs: number; amplitudeScale: number }>>;
  gazeCoordination?: {
    mode: "follow" | "noFollow" | "reverseFollow";
    headDelayMs: number | null;
    gazeChannels: SpeechGestureChannel[];
    headChannels: SpeechGestureChannel[];
  } | null;
}

export interface SpeechPerformanceExpression {
  emotion: string;
  variantId: string;
  facs: PartialFACSLikeState;
  supportedChannels: SpeechExpressionChannel[];
  gestureAffinity: string[];
}

export interface SpeechPerformancePlan {
  version: 1;
  lifecycleToken?: SpeechPerformancePlanToken;
  seed: number;
  emotion: string;
  vad: VADVector;
  intensity: number;
  confidence: number;
  semanticCues: string[];
  deliveryHints: string[];
  currentPosture: Partial<Record<SpeechGestureChannel, number>>;
  durationMs: number;
  motionBudget: Required<Pick<SpeechPerformanceMotionBudget, "maxSimultaneousAxes" | "maxMotionDensity" | "minRestWindowMs">> & {
    usedMotionDensity: number;
    maxSimultaneousAxesUsed: number;
  };
  expression: SpeechPerformanceExpression;
  gestures: SpeechPerformanceGesture[];
}

export interface SpeechPerformanceHistoryEntry {
  gestureId?: string;
  cooldownGroup?: string;
  direction?: -1 | 1;
  gazeFollowMode?: "follow" | "noFollow" | "reverseFollow";
  expressionVariantId?: string;
}

export interface SpeechPerformanceSample {
  speechGesture: PartialFACSLikeState;
  expressionAccent: PartialFACSLikeState;
  activeBeatIds: string[];
}

const isSpeechGestureChannel = (key: string): key is SpeechGestureChannel => speechGestureChannels.includes(key as SpeechGestureChannel);
const isSpeechExpressionChannel = (key: string): key is SpeechExpressionChannel => speechExpressionChannels.includes(key as SpeechExpressionChannel);
const finiteOr = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

const emotionAliases: Record<string, string> = {
  angry: "anger",
  fear: "fearful",
  worried: "concerned",
  worry: "concerned",
  positive: "happy"
};

export function normalizeSpeechPerformanceEmotion(value?: string): string {
  const normalized = String(value ?? "neutral").trim().toLowerCase();
  const resolved = emotionAliases[normalized] ?? normalized;
  return SUPPORTED_SPEECH_PERFORMANCE_EMOTIONS.includes(resolved) ? resolved : "neutral";
}

function normalizeVAD(emotion: string, value?: Partial<VADVector>): VADVector {
  const preset = emotionVADPresets[emotion] ?? neutralVAD;
  return {
    valence: clamp(finiteOr(value?.valence, preset.valence), -1, 1),
    arousal: clamp(finiteOr(value?.arousal, preset.arousal), -1, 1),
    dominance: clamp(finiteOr(value?.dominance, preset.dominance), -1, 1)
  };
}

function normalizeLabels(value: readonly string[] | string | undefined, allowed: readonly string[]): string[] {
  const values = typeof value === "string" ? [value] : value ?? [];
  const allow = new Set(allowed);
  return [...new Set(values.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => allow.has(entry)))];
}

const semanticCueAllowlist = ["agreement", "reassurance", "question", "reflection", "uncertainty", "affection", "emphasis", "contrast", "surprise", "tension", "sadness"] as const;
const deliveryHintAllowlist = ["acknowledge", "reassure", "ask", "reflect", "hesitate", "confide", "emphasize", "celebrate", "warn"] as const;

function normalizePosture(value?: Partial<Record<SpeechGestureChannel, number>>): Partial<Record<SpeechGestureChannel, number>> {
  const result: Partial<Record<SpeechGestureChannel, number>> = {};
  for (const [key, raw] of Object.entries(value ?? {})) {
    if (isSpeechGestureChannel(key) && Number.isFinite(Number(raw))) result[key] = clamp(Number(raw), -1, 1);
  }
  return result;
}

function normalizeMotionBudget(capabilities: SpeechPerformanceCapabilities): ResolvedSpeechPerformanceCapabilities["motionBudget"] {
  const configured = capabilities.motionBudget ?? {};
  let maxSimultaneousAxes = Math.trunc(finiteOr(configured.maxSimultaneousAxes, 4));
  let maxMotionDensity = finiteOr(configured.maxMotionDensity, 0.84);
  let minRestWindowMs = finiteOr(configured.minRestWindowMs, 100);
  if (capabilities.performanceTier === "low") {
    maxSimultaneousAxes = Math.min(maxSimultaneousAxes, 3);
    maxMotionDensity = Math.min(maxMotionDensity, 0.62);
    minRestWindowMs = Math.max(minRestWindowMs, 160);
  }
  if (capabilities.reducedMotion) {
    maxSimultaneousAxes = Math.min(maxSimultaneousAxes, 2);
    maxMotionDensity = Math.min(maxMotionDensity, 0.38);
    minRestWindowMs = Math.max(minRestWindowMs, 240);
  }
  return {
    maxSimultaneousAxes: clamp(Math.trunc(maxSimultaneousAxes), 1, 8),
    maxMotionDensity: clamp(maxMotionDensity, 0.12, 1),
    minRestWindowMs: clamp(minRestWindowMs, 0, 2000)
  };
}

function normalizeCapabilities(input: SpeechPerformanceCapabilities = {}): ResolvedSpeechPerformanceCapabilities {
  const tierScale = input.performanceTier === "low" ? 0.58 : input.performanceTier === "medium" ? 0.82 : 1;
  const motionScale = input.reducedMotion ? 0.38 : 1;
  const channelsEnabled = input.enabled !== false;
  return {
    enabled: channelsEnabled,
    gestureChannels: new Set(channelsEnabled ? input.gestureChannels ?? speechGestureChannels : []),
    expressionChannels: new Set(channelsEnabled ? input.expressionChannels ?? speechExpressionChannels : []),
    channelScales: input.channelScales ?? {},
    maxGestureAmplitude: clamp(input.maxGestureAmplitude ?? 1, 0, 1),
    gestureAmplitudeGain: clamp(input.gestureAmplitudeGain ?? 1, 0, 2.6),
    gestureLimit: clamp(Math.trunc(finiteOr(input.gestureLimit, 4)), 0, 4),
    scale: tierScale * motionScale,
    motionBudget: normalizeMotionBudget(input)
  };
}

function modelHas(profile: ModelProfile, key: FACSKey): boolean {
  // Capability groups describe what a model can do in broad terms. The
  // planner must still require a concrete semantic mapping so it never emits
  // an axis that ModelProfileAdapter cannot apply.
  return Boolean(profile.parameterMap?.[key]);
}

export function deriveSpeechPerformanceCapabilities(
  profile: ModelProfile,
  overrides: SpeechPerformanceCapabilities = {}
): SpeechPerformanceCapabilities {
  const gestureChannels = speechGestureChannels.filter((key) => {
    return modelHas(profile, key);
  });
  const expressionChannels = speechExpressionChannels.filter((key) => {
    return modelHas(profile, key);
  });
  return {
    ...overrides,
    gestureChannels: overrides.gestureChannels ?? gestureChannels,
    expressionChannels: overrides.expressionChannels ?? expressionChannels
  };
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

export function createSpeechPerformanceSeed(input: {
  turnOrdinal?: number;
  segmentOrdinal?: number;
  emotion?: string;
  durationMs?: number;
  revision?: number;
} = {}): number {
  const material = [
    Math.trunc(input.turnOrdinal ?? 0),
    Math.trunc(input.segmentOrdinal ?? 0),
    normalizeSpeechPerformanceEmotion(input.emotion),
    Math.round(clamp(input.durationMs ?? 0, 0, 120000) / 250),
    Math.trunc(input.revision ?? 1)
  ].join("|");
  return hashSeed(material);
}

function normalizePeaks(input: SpeechPerformancePlanInput["audioPeaks"], durationMs: number): Array<{ ratio: number; strength: number }> {
  return (input ?? []).map((peak) => {
    if (typeof peak === "number") return { ratio: clamp(peak, 0, 1), strength: 0.75 };
    const ratio = Number.isFinite(Number(peak.ratio ?? peak.timeRatio))
      ? clamp(Number(peak.ratio ?? peak.timeRatio), 0, 1)
      : clamp(Number(peak.timeMs) / Math.max(1, durationMs), 0, 1);
    return { ratio, strength: clamp(finiteOr(peak.strength ?? peak.energy, 0.75), 0, 1) };
  }).filter((peak) => peak.ratio >= 0.1 && peak.ratio <= 0.92).sort((a, b) => b.strength - a.strength);
}

function curvePeak(curveId: SpeechPerformanceCurveId): number {
  let peak = 0;
  let peakValue = -Infinity;
  for (let index = 0; index <= 100; index += 1) {
    const progress = index / 100;
    const value = sampleSpeechPerformanceCurve(curveId, progress);
    if (value > peakValue) {
      peak = progress;
      peakValue = value;
    }
  }
  return peak;
}

function vadDistance(expected: readonly [number, number, number], actual: VADVector): number {
  return (Math.abs(expected[0] - actual.valence) + Math.abs(expected[1] - actual.arousal) + Math.abs(expected[2] - actual.dominance)) / 3;
}

function historyPenalty(id: string, history: readonly SpeechPerformanceHistoryEntry[], key: keyof SpeechPerformanceHistoryEntry): number {
  let penalty = 0;
  history.slice(-6).reverse().forEach((entry, index) => {
    if (entry[key] === id) penalty += 3.2 / (index + 1);
  });
  return penalty;
}

function selectExpression(
  emotion: string,
  intensity: number,
  confidence: number,
  capabilities: ResolvedSpeechPerformanceCapabilities,
  history: readonly SpeechPerformanceHistoryEntry[],
  random: RandomSource
): SpeechPerformanceExpression {
  const variants = SPEECH_EXPRESSION_VARIANTS[emotion] ?? SPEECH_EXPRESSION_VARIANTS.neutral;
  const ranked = variants.map((variant) => ({
    variant,
    score: historyPenalty(variant.id, history, "expressionVariantId") + random() * 0.3
  })).sort((a, b) => a.score - b.score);
  const selected = ranked[Math.min(ranked.length - 1, Math.floor(random() * Math.min(2, ranked.length)))]?.variant ?? variants[0];
  const supportedChannels = Object.keys(selected.facs).filter((key): key is SpeechExpressionChannel => isSpeechExpressionChannel(key) && capabilities.expressionChannels.has(key));
  const scale = (0.35 + intensity * 0.65) * (0.7 + confidence * 0.3) * capabilities.scale;
  const facs: PartialFACSLikeState = {};
  for (const key of supportedChannels) {
    const value = selected.facs[key];
    if (typeof value === "number") facs[key] = clamp(value * scale, 0, 1);
  }
  return { emotion, variantId: selected.id, facs, supportedChannels, gestureAffinity: [...selected.gestureAffinity] };
}

function resolveGestureCount(durationMs: number, capabilities: ResolvedSpeechPerformanceCapabilities): number {
  if (!capabilities.enabled || capabilities.gestureLimit <= 0 || durationMs < 850) return 0;
  if (durationMs < 1800) return Math.min(1, capabilities.gestureLimit);
  if (durationMs < 3600) return Math.min(2, capabilities.gestureLimit);
  return Math.min(3, capabilities.gestureLimit);
}

function beatRatios(count: number, peaks: Array<{ ratio: number; strength: number }>): Array<{ ratio: number; strength: number }> {
  if (count === 0) return [];
  const defaults = count === 1 ? [0.52] : count === 2 ? [0.32, 0.72] : [0.24, 0.52, 0.8];
  return defaults.map((ratio, index) => peaks[index] ? { ratio: peaks[index].ratio, strength: peaks[index].strength } : { ratio, strength: 0.62 });
}

function templateScore(
  id: string,
  definition: SpeechGestureTemplate,
  emotion: string,
  vad: VADVector,
  intensity: number,
  semanticCues: readonly string[],
  deliveryHints: readonly string[],
  expression: SpeechPerformanceExpression,
  history: readonly SpeechPerformanceHistoryEntry[],
  random: RandomSource
): number {
  const emotionScore = definition.emotions.includes(emotion) ? 4 : 0;
  const cueScore = definition.semanticCues.filter((cue) => semanticCues.includes(cue)).length * 1.2;
  const hintScore = definition.deliveryHints.filter((hint) => deliveryHints.includes(hint)).length * 1.4;
  const affinityScore = expression.gestureAffinity.includes(id) ? 2 : 0;
  return emotionScore + cueScore + hintScore + affinityScore + intensity * 0.5 - vadDistance(definition.vad, vad) * 3
    - historyPenalty(id, history, "gestureId") - historyPenalty(definition.cooldownGroup, history, "cooldownGroup") + random() * 0.35;
}

function availableChannels(definition: SpeechGestureTemplate, capabilities: ResolvedSpeechPerformanceCapabilities): Array<[SpeechGestureChannel, number]> {
  return Object.entries(definition.channels).flatMap(([key, value]) => {
    if (!isSpeechGestureChannel(key) || typeof value !== "number" || !capabilities.gestureChannels.has(key)) return [];
    return [[key, value] as [SpeechGestureChannel, number]];
  });
}

function coordinateGazeAndHead(
  channels: Partial<Record<SpeechGestureChannel, number>>,
  history: readonly SpeechPerformanceHistoryEntry[],
  random: RandomSource
): Pick<SpeechPerformanceGesture, "channelTimings" | "gazeCoordination" | "channels"> {
  const gazeChannels = Object.keys(channels).filter((key): key is SpeechGestureChannel => key.startsWith("gaze") && isSpeechGestureChannel(key));
  if (gazeChannels.length === 0) return { channels, channelTimings: {}, gazeCoordination: null };

  const relatedHeadChannels = [
    ...(gazeChannels.includes("gazeX") ? ["headX", "headZ"] : []),
    ...(gazeChannels.includes("gazeY") ? ["headY"] : [])
  ].filter((key): key is SpeechGestureChannel => key in channels);
  if (relatedHeadChannels.length === 0) {
    return {
      channels,
      channelTimings: {},
      gazeCoordination: { mode: "noFollow", headDelayMs: null, gazeChannels, headChannels: [] }
    };
  }

  const modes = ["follow", "noFollow", "reverseFollow"] as const;
  const mode = modes
    .map((candidate, index) => ({
      candidate,
      score: historyPenalty(candidate, history, "gazeFollowMode") + index * 0.1 + random() * 0.5
    }))
    .sort((left, right) => left.score - right.score)[0].candidate;
  const headDelayMs = mode === "noFollow" ? null : 80 + Math.floor(random() * 101);
  const coordinatedChannels = { ...channels };
  const channelTimings: SpeechPerformanceGesture["channelTimings"] = {};
  for (const key of gazeChannels) channelTimings[key] = { offsetMs: 0, amplitudeScale: 1 };
  if (mode === "noFollow") {
    for (const key of relatedHeadChannels) delete coordinatedChannels[key];
  } else {
    for (const key of relatedHeadChannels) {
      channelTimings[key] = { offsetMs: headDelayMs ?? 0, amplitudeScale: mode === "reverseFollow" ? -0.45 : 0.72 };
    }
  }
  return {
    channels: coordinatedChannels,
    channelTimings,
    gazeCoordination: { mode, headDelayMs, gazeChannels, headChannels: relatedHeadChannels }
  };
}

export function planSpeechPerformance(input: SpeechPerformancePlanInput = {}): SpeechPerformancePlan {
  const emotion = normalizeSpeechPerformanceEmotion(input.emotion);
  const durationMs = clamp(finiteOr(input.durationMs, 0), 0, 120000);
  const intensity = clamp(finiteOr(input.intensity, 0.55), 0, 1);
  const confidence = clamp(finiteOr(input.confidence ?? input.emotionConfidence, 0.75), 0, 1);
  const semanticCues = normalizeLabels(input.semanticCues, semanticCueAllowlist);
  const deliveryHints = normalizeLabels(input.deliveryHints, deliveryHintAllowlist);
  const currentPosture = normalizePosture(input.currentPosture);
  const vad = normalizeVAD(emotion, input.vad);
  const capabilities = normalizeCapabilities(input.capabilities);
  const history = normalizeHistory(input.history);
  const seed = Number.isFinite(Number(input.seed)) ? Number(input.seed) >>> 0 : createSpeechPerformanceSeed({
    turnOrdinal: input.turnOrdinal,
    segmentOrdinal: input.segmentOrdinal,
    emotion,
    durationMs,
    revision: input.revision
  });
  const random = seededRandom(seed);
  const expressionPlan = selectExpression(emotion, intensity, confidence, capabilities, history, random);
  const count = resolveGestureCount(durationMs, capabilities);
  const peaks = normalizePeaks(input.audioPeaks, durationMs);
  const candidates = Object.entries(SPEECH_GESTURE_TEMPLATES)
    .filter(([, definition]) => durationMs >= definition.durationBoundsMs[0] && durationMs <= definition.durationBoundsMs[1])
    .filter(([, definition]) => availableChannels(definition, capabilities).length > 0)
    .map(([id, definition]) => ({ id, definition, score: templateScore(id, definition, emotion, vad, intensity, semanticCues, deliveryHints, expressionPlan, history, random) }))
    .sort((left, right) => right.score - left.score);

  const used = new Set<string>();
  const usedCooldownGroups = new Set<string>();
  const planningHistory = [...history];
  const motionBudget = capabilities.motionBudget;
  const maximumMotionMs = durationMs * motionBudget.maxMotionDensity;
  const ratios = beatRatios(count, peaks);
  let usedMotionMs = 0;
  let previousGestureEndMs: number | null = null;
  let lastDirection = Number([...history].reverse().find((entry) => Math.abs(Number(entry.direction)) === 1)?.direction) || 0;
  let maxSimultaneousAxesUsed = 0;
  const gestures: SpeechPerformanceGesture[] = [];

  for (const [beatIndex, beat] of ratios.entries()) {
    const available = candidates.filter((candidate) => !used.has(candidate.id) && !usedCooldownGroups.has(candidate.definition.cooldownGroup));
    const fallback = candidates.filter((candidate) => !used.has(candidate.id));
    const selected = (available.length ? available : fallback.length ? fallback : candidates)[0];
    if (!selected) continue;

    const { id, definition } = selected;
    const lateralPosture = ["headX", "headZ", "bodyX", "bodyZ", "gazeX"].reduce((total, key) => total + (currentPosture[key as SpeechGestureChannel] ?? 0), 0);
    const direction: -1 | 1 = definition.lateral
      ? lastDirection === 0
        ? Math.abs(lateralPosture) > 0.12 ? lateralPosture > 0 ? -1 : 1 : random() < 0.5 ? -1 : 1
        : lastDirection === 1 ? -1 : 1
      : 1;
    let gestureDurationMs = clamp(durationMs * definition.durationRatio, 360, Math.min(2200, Math.max(360, durationMs * 0.58)));
    gestureDurationMs = Math.min(gestureDurationMs, Math.max(0, maximumMotionMs - usedMotionMs));
    if (gestureDurationMs < 360) continue;
    const peakRatio = curvePeak(definition.curveId);
    const peakMs = beat.ratio * durationMs;
    const desiredStartMs = clamp(peakMs - gestureDurationMs * peakRatio, 0, Math.max(0, durationMs - gestureDurationMs));
    const earliestStartMs = previousGestureEndMs === null ? 0 : previousGestureEndMs + motionBudget.minRestWindowMs;
    const startMs = Math.max(desiredStartMs, earliestStartMs);
    gestureDurationMs = Math.min(gestureDurationMs, durationMs - startMs);
    if (gestureDurationMs < 360) continue;

    const energyScale = (0.34 + intensity * 0.46 + Math.abs(vad.arousal) * 0.2)
      * (0.72 + beat.strength * 0.28) * capabilities.scale
      * (0.58 + confidence * 0.42);
    const rankedChannels = availableChannels(definition, capabilities).map(([key, contribution]) => {
      const channelScale = clamp(capabilities.channelScales[key] ?? 1, 0, 1);
      const lateral = definition.lateral && ["headX", "headZ", "bodyX", "bodyZ", "gazeX"].includes(key) ? direction : 1;
      const posture = currentPosture[key] ?? 0;
      const postureHeadroom = posture * Math.sign(contribution * lateral) > 0 ? 1 - Math.abs(posture) * 0.72 : 1;
      const value = clamp(contribution * energyScale * channelScale * capabilities.maxGestureAmplitude * capabilities.gestureAmplitudeGain * lateral * postureHeadroom, -1, 1);
      return [key, value] as const;
    }).sort((left, right) => Math.abs(right[1]) - Math.abs(left[1])).slice(0, motionBudget.maxSimultaneousAxes);
    const rawChannels = Object.fromEntries(rankedChannels) as Partial<Record<SpeechGestureChannel, number>>;
    if (Object.keys(rawChannels).length === 0) continue;
    const coordinated = coordinateGazeAndHead(rawChannels, planningHistory, random);
    used.add(id);
    usedCooldownGroups.add(definition.cooldownGroup);
    if (definition.lateral) lastDirection = direction;
    if (coordinated.gazeCoordination) planningHistory.push({ gazeFollowMode: coordinated.gazeCoordination.mode });
    const roundedStartMs = Math.round(startMs);
    const roundedDurationMs = Math.round(gestureDurationMs);
    const restBeforeMs = previousGestureEndMs === null ? roundedStartMs : Math.max(0, roundedStartMs - previousGestureEndMs);
    previousGestureEndMs = roundedStartMs + roundedDurationMs;
    usedMotionMs += roundedDurationMs;
    maxSimultaneousAxesUsed = Math.max(maxSimultaneousAxesUsed, Object.keys(coordinated.channels).length);
    gestures.push({
      id: `${input.segmentOrdinal ?? 0}:${beatIndex}:${id}`,
      templateId: id,
      family: definition.family,
      cooldownGroup: definition.cooldownGroup,
      curveId: definition.curveId,
      startMs: roundedStartMs,
      durationMs: roundedDurationMs,
      peakMs: Math.round(startMs + gestureDurationMs * peakRatio),
      restBeforeMs,
      direction,
      channels: coordinated.channels,
      channelTimings: coordinated.channelTimings,
      gazeCoordination: coordinated.gazeCoordination
    });
  }

  return {
    version: 1,
    ...(Number.isFinite(Number(input.lifecycleToken))
      ? { lifecycleToken: Math.max(0, Math.trunc(Number(input.lifecycleToken))) }
      : {}),
    seed,
    emotion,
    vad,
    intensity,
    confidence,
    semanticCues,
    deliveryHints,
    currentPosture,
    durationMs,
    motionBudget: {
      ...motionBudget,
      usedMotionDensity: durationMs > 0 ? usedMotionMs / durationMs : 0,
      maxSimultaneousAxesUsed
    },
    expression: expressionPlan,
    gestures
  };
}

function normalizeHistory(value?: readonly SpeechPerformanceHistoryEntry[]): SpeechPerformanceHistoryEntry[] {
  return (value ?? []).slice(-8).map((entry) => ({ ...entry }));
}

function sampleGestureInto(output: PartialFACSLikeState, gesture: SpeechPerformanceGesture, elapsedMs: number) {
  if (elapsedMs < gesture.startMs || elapsedMs > gesture.startMs + gesture.durationMs) return;
  for (const [key, amplitude] of Object.entries(gesture.channels)) {
    if (!isSpeechGestureChannel(key) || typeof amplitude !== "number") continue;
    const timing = gesture.channelTimings?.[key];
    const offsetMs = clamp(timing?.offsetMs ?? 0, 0, Math.max(0, gesture.durationMs - 1));
    const channelElapsedMs = elapsedMs - gesture.startMs - offsetMs;
    if (channelElapsedMs < 0) continue;
    const progress = channelElapsedMs / Math.max(1, gesture.durationMs - offsetMs);
    const value = amplitude * sampleSpeechPerformanceCurve(gesture.curveId, progress) * (timing?.amplitudeScale ?? 1);
    output[key] = clamp((output[key] ?? 0) + value, -1, 1);
  }
}

export function sampleSpeechPerformance(plan: SpeechPerformancePlan | undefined, elapsedMs: number): SpeechPerformanceSample {
  const speechGesture: PartialFACSLikeState = {};
  const activeBeatIds: string[] = [];
  const elapsed = Math.max(0, finiteOr(elapsedMs, 0));
  for (const gesture of plan?.gestures ?? []) {
    if (elapsed < gesture.startMs || elapsed > gesture.startMs + gesture.durationMs) continue;
    activeBeatIds.push(gesture.id);
    sampleGestureInto(speechGesture, gesture, elapsed);
  }
  const expressionAccent = elapsed <= (plan?.durationMs ?? 0) ? { ...(plan?.expression.facs ?? {}) } : {};
  return {
    speechGesture: clampFACSState(speechGesture),
    expressionAccent: clampFACSState(expressionAccent),
    activeBeatIds
  };
}

export function validateSpeechPerformanceRegistries(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [curveId, curve] of Object.entries(SPEECH_PERFORMANCE_CURVES)) {
    if (curve.keyframes[0]?.at !== 0 || curve.keyframes[curve.keyframes.length - 1]?.at !== 1) errors.push(`curves.${curveId}.keyframes must span 0..1`);
    if (curve.range[0] > curve.range[1]) errors.push(`curves.${curveId}.range is inverted`);
    for (const point of curve.keyframes) {
      if (point.at < 0 || point.at > 1 || point.value < curve.range[0] || point.value > curve.range[1]) errors.push(`curves.${curveId} has an out-of-range keyframe`);
    }
  }
  for (const [templateId, definition] of Object.entries(SPEECH_GESTURE_TEMPLATES)) {
    if (definition.durationRatio <= 0 || definition.durationRatio > 1) errors.push(`gestures.${templateId}.durationRatio is invalid`);
    if (Object.keys(definition.channels).length === 0) errors.push(`gestures.${templateId}.channels is empty`);
    for (const key of Object.keys(definition.channels)) if (!isSpeechGestureChannel(key)) errors.push(`gestures.${templateId} contains a non-gesture channel`);
  }
  for (const [emotion, variants] of Object.entries(SPEECH_EXPRESSION_VARIANTS)) {
    if (variants.length < 3) errors.push(`expressions.${emotion} needs three variants`);
    for (const variant of variants) {
      for (const key of Object.keys(variant.facs)) if (!isSpeechExpressionChannel(key)) errors.push(`expressions.${emotion}.${variant.id} contains an unsafe channel`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export class SpeechPerformancePlanner {
  private history: SpeechPerformanceHistoryEntry[] = [];
  private readonly historyLimit: number;
  private recordedSeeds = new Set<string>();

  constructor(options: { historyLimit?: number } = {}) {
    this.historyLimit = clamp(Math.trunc(options.historyLimit ?? 8), 1, 32);
  }

  plan(input: SpeechPerformancePlanInput = {}): SpeechPerformancePlan {
    const plan = planSpeechPerformance({
      ...input,
      history: this.history,
      capabilities: input.capabilities ? { ...input.capabilities } : undefined
    });
    this.recordPlan(plan);
    return plan;
  }

  recordPlan(plan: SpeechPerformancePlan | undefined) {
    if (!plan) return;
    const seedKey = String(plan.seed >>> 0);
    if (this.recordedSeeds.has(seedKey)) return;
    for (const gesture of plan.gestures) {
      this.history.push({
        gestureId: gesture.templateId,
        cooldownGroup: gesture.cooldownGroup,
        direction: gesture.direction,
        gazeFollowMode: gesture.gazeCoordination?.mode
      });
    }
    this.history.push({ expressionVariantId: plan.expression.variantId });
    this.history = this.history.slice(-this.historyLimit);
    this.recordedSeeds.add(seedKey);
    if (this.recordedSeeds.size > 64) this.recordedSeeds.delete(this.recordedSeeds.values().next().value as string);
  }

  getHistory(): SpeechPerformanceHistoryEntry[] {
    return this.history.map((entry) => ({ ...entry }));
  }

  clear() {
    this.history = [];
    this.recordedSeeds.clear();
  }
}

export function createSpeechPerformancePlanner(options: { historyLimit?: number } = {}) {
  const planner = new SpeechPerformancePlanner(options);
  return {
    plan: (input: SpeechPerformancePlanInput = {}) => planner.plan({ ...input, capabilities: input.capabilities }),
    evaluate: sampleSpeechPerformance,
    recordPlan: (plan: SpeechPerformancePlan) => planner.recordPlan(plan),
    clear: () => planner.clear(),
    getHistory: () => planner.getHistory()
  };
}
