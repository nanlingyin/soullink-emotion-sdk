import type { VADVector } from "../emotion/VADState";
import { addFACS, clampFACSState } from "../facs/FACSUtils";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";
import { evaluateExpressionTimeline } from "../expression/ExpressionTimeline";
import type { RuntimeExpressionKeyframe } from "../expression/EmotionArchetype";
import { clamp } from "../utils/clamp";
import { seededRandom, type RandomSource } from "../utils/seededRandom";

interface VoiceWaitingMotion {
  label: string;
  startedAt: number;
  duration: number;
  frames: RuntimeExpressionKeyframe[];
}

interface WaitingMotionContext {
  side: number;
  amplitude: number;
  tempo: number;
  random: RandomSource;
  style: WaitingMotionStyle;
}

interface WaitingMotionStyle {
  emotion: string;
  valence: number;
  arousal: number;
  dominance: number;
  intensity: number;
  postureBias: PartialFACSLikeState;
}

type WaitingMotionTemplate = {
  label: string;
  build: (context: WaitingMotionContext, duration: number) => RuntimeExpressionKeyframe[];
  weight: (style: WaitingMotionStyle) => number;
};

export interface VoiceWaitingMotionOptions {
  emotion?: string;
  intensity?: number;
  vad?: Partial<VADVector>;
}

export interface VoiceWaitingMotionStartInfo {
  label: string;
  duration: number;
  amplitude: number;
  tempo: number;
  emotion: string;
  vad: VADVector;
}

const baseTemplateDurationSeconds = 6;
const waitingDurationSeconds = 9;
const waitingAmplitudeScale = 0.4;

export class VoiceWaitingMotionController {
  private motion: VoiceWaitingMotion | null = null;

  start(
    timeSeconds: number,
    seed = Math.round(timeSeconds * 1000),
    options: VoiceWaitingMotionOptions = {}
  ): VoiceWaitingMotionStartInfo {
    const random = seededRandom(seed);
    const side = random() < 0.5 ? -1 : 1;
    const style = createWaitingMotionStyle(options, side);
    const duration = clamp(waitingDurationSeconds + (random() - 0.5) * 0.4 - style.arousal * 0.28, 8.6, 9.4);
    const amplitude = (0.82 + random() * 0.18) * waitingAmplitudeScale * waitingAmplitudeFactor(style);
    const tempo = clamp((0.92 + random() * 0.16) * (1 - style.arousal * 0.13), 0.78, 1.24);
    const template = pickWaitingTemplate(random, style);

    this.motion = {
      label: template.label,
      startedAt: timeSeconds,
      duration,
      frames: template.build({ side, amplitude, tempo, random, style }, duration)
    };

    return {
      label: template.label,
      duration,
      amplitude,
      tempo,
      emotion: style.emotion,
      vad: {
        valence: style.valence,
        arousal: style.arousal,
        dominance: style.dominance
      }
    };
  }

  reset() {
    this.motion = null;
  }

  update(timeSeconds: number, bodyMotionGain = 1): PartialFACSLikeState {
    if (!this.motion) return {};

    const elapsed = timeSeconds - this.motion.startedAt;
    if (elapsed >= this.motion.duration) {
      this.motion = null;
      return {};
    }

    const layer = evaluateExpressionTimeline(this.motion.frames, elapsed);
    const gain = Math.max(0, Math.min(bodyMotionGain, 4));

    return clampFACSState({
      ...layer,
      headX: (layer.headX ?? 0) * gain,
      headY: (layer.headY ?? 0) * gain,
      headZ: (layer.headZ ?? 0) * gain,
      bodyX: (layer.bodyX ?? 0) * gain,
      bodyY: (layer.bodyY ?? 0) * gain,
      bodyZ: (layer.bodyZ ?? 0) * gain
    });
  }
}

const waitingTemplates: WaitingMotionTemplate[] = [
  {
    label: "slow-sway",
    build: buildSlowSwayFrames,
    weight: (style) => 1.15 + Math.max(-style.arousal, 0) * 0.55 + Math.max(style.valence, 0) * 0.28
  },
  {
    label: "figure-eight",
    build: buildFigureEightFrames,
    weight: (style) => 0.75 + Math.max(style.arousal, 0) * 0.38 + Math.max(style.dominance, 0) * 0.24
  },
  {
    label: "curious-lean",
    build: buildCuriousLeanFrames,
    weight: (style) => 0.52 + emotionWeight(style, ["curious", "confused", "surprised"], 2.25) + Math.max(style.arousal, 0) * 0.16
  },
  {
    label: "shy-rock",
    build: buildShyRockFrames,
    weight: (style) => 0.54 + emotionWeight(style, ["shy", "affectionate"], 2.2) + Math.max(-style.dominance, 0) * 0.72
  },
  {
    label: "buoyant-bob",
    build: buildBuoyantBobFrames,
    weight: (style) => 0.52 + emotionWeight(style, ["happy", "excited"], 2.2) + Math.max(style.valence, 0) * 0.74
  },
  {
    label: "soft-settle",
    build: buildSoftSettleFrames,
    weight: (style) => 0.44 + emotionWeight(style, ["sad", "tired", "concerned", "calm"], 1.9) + Math.max(-style.valence, 0) * 0.82 + Math.max(-style.arousal, 0) * 0.55
  },
  {
    label: "contained-tension",
    build: buildContainedTensionFrames,
    weight: (style) => 0.34 + emotionWeight(style, ["anxiety", "anger", "angry"], 2.15) + Math.max(style.arousal, 0) * 0.58 + Math.max(-style.valence, 0) * 0.45
  }
];

function pickWaitingTemplate(random: RandomSource, style: WaitingMotionStyle): WaitingMotionTemplate {
  const weighted = waitingTemplates.map((template) => ({
    template,
    weight: Math.max(0.05, template.weight(style))
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;

  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.template;
  }

  return waitingTemplates[0];
}

function createWaitingMotionStyle(options: VoiceWaitingMotionOptions, side: number): WaitingMotionStyle {
  const vad = normalizeVAD(options.vad);
  const emotion = normalizeEmotion(options.emotion);
  const intensity = clamp(options.intensity ?? estimateVADIntensity(vad), 0, 1);
  const positive = Math.max(vad.valence, 0);
  const negative = Math.max(-vad.valence, 0);
  const highArousal = Math.max(vad.arousal, 0);
  const lowArousal = Math.max(-vad.arousal, 0);
  const confident = Math.max(vad.dominance, 0);
  const withdrawn = Math.max(-vad.dominance, 0);
  const shy = isEmotion(emotion, ["shy", "affectionate"]);
  const anxious = isEmotion(emotion, ["anxiety"]) || (negative > 0.32 && highArousal > 0.34);
  const angry = isEmotion(emotion, ["anger", "angry"]) || (negative > 0.38 && highArousal > 0.38 && confident > 0.12);
  const curious = isEmotion(emotion, ["curious", "confused", "surprised"]);

  return {
    emotion,
    valence: vad.valence,
    arousal: vad.arousal,
    dominance: vad.dominance,
    intensity,
    postureBias: clampFACSState({
      headY: positive * 0.024 - negative * 0.036 + highArousal * 0.012 - lowArousal * 0.008,
      headZ: side * (withdrawn * 0.036 + (shy ? 0.032 : 0) - confident * 0.014),
      bodyY: positive * 0.026 - negative * 0.03 - lowArousal * 0.008,
      bodyZ: side * (withdrawn * 0.026 + (shy ? 0.016 : 0) - confident * 0.012),
      gazeX: side * (withdrawn * 0.036 + (shy ? 0.026 : 0) - confident * 0.01),
      gazeY: positive * 0.016 - negative * 0.05 + highArousal * 0.012,
      eyeSmile: positive * 0.06 + (shy ? 0.04 : 0),
      eyeSquint: angry ? 0.036 + intensity * 0.018 : 0,
      browOuterUp: highArousal * 0.034 + (curious ? 0.046 : 0),
      browInnerUp: negative * 0.052 + withdrawn * 0.034 + (anxious ? 0.048 : 0),
      browDown: angry ? 0.048 + intensity * 0.028 : 0,
      mouthSmile: positive * 0.06 + (shy ? 0.034 : 0),
      mouthFrown: negative * 0.044,
      blush: shy ? 0.066 + positive * 0.028 : 0,
      sweat: anxious ? 0.046 + highArousal * 0.026 : 0
    })
  };
}

function normalizeVAD(vad?: Partial<VADVector>): VADVector {
  return {
    valence: clamp(vad?.valence ?? 0, -1, 1),
    arousal: clamp(vad?.arousal ?? 0, -1, 1),
    dominance: clamp(vad?.dominance ?? 0, -1, 1)
  };
}

function estimateVADIntensity(vad: VADVector): number {
  return clamp((Math.abs(vad.valence) + Math.abs(vad.arousal) * 0.9 + Math.abs(vad.dominance) * 0.7) / 2.6, 0, 1);
}

function waitingAmplitudeFactor(style: WaitingMotionStyle): number {
  const highArousal = Math.max(style.arousal, 0);
  const lowArousal = Math.max(-style.arousal, 0);
  const negative = Math.max(-style.valence, 0);
  const confident = Math.max(style.dominance, 0);
  const withdrawn = Math.max(-style.dominance, 0);

  return clamp(
    1 + highArousal * 0.14 - lowArousal * 0.1 + confident * 0.05 - negative * 0.08 - withdrawn * 0.04 + style.intensity * 0.08,
    0.72,
    1.18
  );
}

function emotionWeight(style: WaitingMotionStyle, emotions: string[], boost: number): number {
  return isEmotion(style.emotion, emotions) ? boost : 0;
}

function isEmotion(emotion: string, emotions: string[]): boolean {
  return emotions.includes(emotion);
}

function normalizeEmotion(emotion?: string): string {
  const normalized = emotion?.trim().toLowerCase() ?? "";
  if (normalized === "soft-happy" || normalized === "soft-positive") return "happy";
  if (normalized === "soft-calm") return "calm";
  if (normalized === "soft-curious") return "curious";
  if (normalized === "soft-shy") return "shy";
  if (normalized === "soft-uneasy") return "anxiety";
  if (normalized === "soft-low") return "sad";
  if (normalized === "soft-steady") return "neutral";
  return normalized || "neutral";
}

function buildSlowSwayFrames(context: WaitingMotionContext, duration: number): RuntimeExpressionKeyframe[] {
  const { side, amplitude, tempo } = context;
  const t = createWaitingTimeScaler(duration);

  return [
    styledFrame(context, 0, t(1.18 * tempo), "easeOut", waitingSwayFrame(side, amplitude, 1)),
    styledFrame(context, t(1.44 * tempo), t(1.38 * tempo), "easeInOut", waitingSwayFrame(-side, amplitude * 0.92, 2)),
    styledFrame(context, t(3 * tempo), t(1.22 * tempo), "easeInOut", waitingSwayFrame(side, amplitude * 0.62, 3)),
    frame(t(4.5), duration - t(4.5), "easeOut", waitingSwayRestFrame())
  ];
}

function buildFigureEightFrames(context: WaitingMotionContext, duration: number): RuntimeExpressionKeyframe[] {
  const { side, amplitude, tempo, random } = context;
  const t = createWaitingTimeScaler(duration);
  const gazeLead = 0.14 + random() * 0.08;

  return [
    styledFrame(context, 0, t(0.96 * tempo), "easeOut", clampFACSState({
      headX: side * amplitude * 0.2,
      headY: amplitude * 0.1,
      headZ: side * amplitude * 0.42,
      bodyX: -side * amplitude * 0.16,
      bodyY: amplitude * 0.12,
      bodyZ: side * amplitude * 0.32,
      gazeX: -side * amplitude * gazeLead,
      gazeY: amplitude * 0.08,
      eyeSmile: amplitude * 0.12,
      mouthSmile: amplitude * 0.12
    })),
    styledFrame(context, t(1.2 * tempo), t(1.08 * tempo), "easeInOut", clampFACSState({
      headX: -side * amplitude * 0.18,
      headY: -amplitude * 0.05,
      headZ: -side * amplitude * 0.36,
      bodyX: side * amplitude * 0.15,
      bodyY: amplitude * 0.08,
      bodyZ: -side * amplitude * 0.3,
      gazeX: side * amplitude * gazeLead,
      gazeY: -amplitude * 0.04,
      browOuterUp: amplitude * 0.08,
      mouthSmile: amplitude * 0.1
    })),
    styledFrame(context, t(2.55 * tempo), t(1.06 * tempo), "easeInOut", clampFACSState({
      headX: side * amplitude * 0.15,
      headY: amplitude * 0.06,
      headZ: side * amplitude * 0.3,
      bodyX: side * amplitude * 0.1,
      bodyY: amplitude * 0.1,
      bodyZ: side * amplitude * 0.24,
      gazeX: -side * amplitude * gazeLead * 0.7,
      gazeY: amplitude * 0.05,
      eyeSmile: amplitude * 0.1
    })),
    frame(t(4.3), duration - t(4.3), "easeOut", waitingSwayRestFrame())
  ];
}

function buildCuriousLeanFrames(context: WaitingMotionContext, duration: number): RuntimeExpressionKeyframe[] {
  const { side, amplitude, tempo, random } = context;
  const t = createWaitingTimeScaler(duration);
  const tilt = 0.34 + random() * 0.12;

  return [
    styledFrame(context, 0, t(1.08 * tempo), "easeOut", clampFACSState({
      headX: side * amplitude * 0.12,
      headY: amplitude * 0.18,
      headZ: side * amplitude * tilt,
      bodyY: amplitude * 0.3,
      bodyZ: side * amplitude * 0.18,
      gazeX: side * amplitude * 0.18,
      gazeY: amplitude * 0.14,
      browOuterUp: amplitude * 0.16,
      eyeSmile: amplitude * 0.08,
      mouthSmile: amplitude * 0.08
    })),
    styledFrame(context, t(1.65 * tempo), t(1.18 * tempo), "easeInOut", clampFACSState({
      headX: -side * amplitude * 0.08,
      headY: amplitude * 0.12,
      headZ: -side * amplitude * 0.22,
      bodyY: amplitude * 0.2,
      bodyZ: -side * amplitude * 0.12,
      gazeX: -side * amplitude * 0.22,
      gazeY: amplitude * 0.08,
      browOuterUp: amplitude * 0.12,
      eyeSquint: amplitude * 0.06
    })),
    styledFrame(context, t(3.35), t(1.05), "easeInOut", clampFACSState({
      headY: amplitude * 0.06,
      bodyY: amplitude * 0.1,
      gazeY: amplitude * 0.04,
      eyeSmile: amplitude * 0.08,
      mouthSmile: amplitude * 0.08
    })),
    frame(t(4.55), duration - t(4.55), "easeOut", waitingSwayRestFrame())
  ];
}

function buildShyRockFrames(context: WaitingMotionContext, duration: number): RuntimeExpressionKeyframe[] {
  const { side, amplitude, tempo } = context;
  const t = createWaitingTimeScaler(duration);

  return [
    styledFrame(context, 0, t(1.15 * tempo), "easeOut", clampFACSState({
      headY: -amplitude * 0.2,
      headZ: -side * amplitude * 0.34,
      bodyX: side * amplitude * 0.12,
      bodyY: -amplitude * 0.12,
      bodyZ: -side * amplitude * 0.28,
      gazeX: side * amplitude * 0.2,
      gazeY: -amplitude * 0.14,
      browInnerUp: amplitude * 0.12,
      blush: amplitude * 0.12,
      mouthSmile: amplitude * 0.1
    })),
    styledFrame(context, t(1.68 * tempo), t(1.25 * tempo), "easeInOut", clampFACSState({
      headY: -amplitude * 0.16,
      headZ: side * amplitude * 0.28,
      bodyX: -side * amplitude * 0.1,
      bodyY: -amplitude * 0.08,
      bodyZ: side * amplitude * 0.22,
      gazeX: -side * amplitude * 0.14,
      gazeY: -amplitude * 0.1,
      eyeSmile: amplitude * 0.1,
      blush: amplitude * 0.14,
      mouthSmile: amplitude * 0.12
    })),
    styledFrame(context, t(3.3), t(1.05), "easeInOut", clampFACSState({
      headY: -amplitude * 0.08,
      gazeY: -amplitude * 0.05,
      blush: amplitude * 0.08,
      mouthSmile: amplitude * 0.08
    })),
    frame(t(4.55), duration - t(4.55), "easeOut", waitingSwayRestFrame())
  ];
}

function buildBuoyantBobFrames(context: WaitingMotionContext, duration: number): RuntimeExpressionKeyframe[] {
  const { side, amplitude, tempo, random } = context;
  const t = createWaitingTimeScaler(duration);
  const bob = 0.2 + random() * 0.08;

  return [
    styledFrame(context, 0, t(0.9 * tempo), "easeOut", clampFACSState({
      headY: amplitude * bob,
      headZ: side * amplitude * 0.2,
      bodyY: amplitude * 0.28,
      bodyZ: side * amplitude * 0.16,
      gazeY: amplitude * 0.08,
      eyeSmile: amplitude * 0.16,
      browOuterUp: amplitude * 0.08,
      mouthSmile: amplitude * 0.16
    })),
    styledFrame(context, t(1.18 * tempo), t(0.95 * tempo), "easeInOut", clampFACSState({
      headY: -amplitude * 0.08,
      headZ: -side * amplitude * 0.18,
      bodyY: -amplitude * 0.08,
      bodyZ: -side * amplitude * 0.12,
      gazeY: -amplitude * 0.04,
      eyeSmile: amplitude * 0.12,
      mouthSmile: amplitude * 0.12
    })),
    styledFrame(context, t(2.55 * tempo), t(1.12 * tempo), "easeInOut", clampFACSState({
      headY: amplitude * bob * 0.7,
      headZ: side * amplitude * 0.16,
      bodyY: amplitude * 0.18,
      bodyZ: side * amplitude * 0.1,
      gazeX: -side * amplitude * 0.1,
      gazeY: amplitude * 0.05,
      eyeSmile: amplitude * 0.14,
      mouthSmile: amplitude * 0.14
    })),
    frame(t(4.42), duration - t(4.42), "easeOut", waitingSwayRestFrame())
  ];
}

function buildSoftSettleFrames(context: WaitingMotionContext, duration: number): RuntimeExpressionKeyframe[] {
  const { side, amplitude, tempo } = context;
  const t = createWaitingTimeScaler(duration);

  return [
    styledFrame(context, 0, t(1.34 * tempo), "easeOut", clampFACSState({
      headY: -amplitude * 0.14,
      headZ: side * amplitude * 0.18,
      bodyY: -amplitude * 0.1,
      bodyZ: side * amplitude * 0.12,
      gazeX: side * amplitude * 0.08,
      gazeY: -amplitude * 0.12,
      browInnerUp: amplitude * 0.1,
      mouthFrown: amplitude * 0.06
    })),
    styledFrame(context, t(1.82 * tempo), t(1.42 * tempo), "easeInOut", clampFACSState({
      headY: -amplitude * 0.07,
      headZ: -side * amplitude * 0.12,
      bodyY: -amplitude * 0.06,
      bodyZ: -side * amplitude * 0.08,
      gazeX: -side * amplitude * 0.06,
      gazeY: -amplitude * 0.08,
      browInnerUp: amplitude * 0.08,
      eyeSmile: amplitude * 0.04
    })),
    styledFrame(context, t(3.52), t(1.08), "easeInOut", clampFACSState({
      headY: -amplitude * 0.04,
      bodyY: -amplitude * 0.04,
      gazeY: -amplitude * 0.05,
      browInnerUp: amplitude * 0.06
    })),
    frame(t(4.72), duration - t(4.72), "easeOut", waitingSwayRestFrame())
  ];
}

function buildContainedTensionFrames(context: WaitingMotionContext, duration: number): RuntimeExpressionKeyframe[] {
  const { side, amplitude, tempo, random } = context;
  const t = createWaitingTimeScaler(duration);
  const tension = 0.76 + random() * 0.18;

  return [
    styledFrame(context, 0, t(0.98 * tempo), "easeOut", clampFACSState({
      headX: side * amplitude * 0.08,
      headY: -amplitude * 0.04,
      headZ: side * amplitude * 0.24 * tension,
      bodyX: side * amplitude * 0.1,
      bodyY: -amplitude * 0.04,
      bodyZ: -side * amplitude * 0.16 * tension,
      gazeX: -side * amplitude * 0.12,
      gazeY: -amplitude * 0.03,
      browDown: amplitude * 0.1,
      eyeSquint: amplitude * 0.06
    })),
    styledFrame(context, t(1.32 * tempo), t(0.92 * tempo), "easeInOut", clampFACSState({
      headX: -side * amplitude * 0.06,
      headY: -amplitude * 0.02,
      headZ: -side * amplitude * 0.18 * tension,
      bodyX: -side * amplitude * 0.08,
      bodyY: -amplitude * 0.03,
      bodyZ: side * amplitude * 0.14 * tension,
      gazeX: side * amplitude * 0.08,
      browDown: amplitude * 0.08,
      eyeSquint: amplitude * 0.05
    })),
    styledFrame(context, t(2.58 * tempo), t(1.26 * tempo), "easeInOut", clampFACSState({
      headY: -amplitude * 0.03,
      headZ: side * amplitude * 0.08,
      bodyY: -amplitude * 0.03,
      bodyZ: side * amplitude * 0.06,
      gazeY: -amplitude * 0.02,
      browDown: amplitude * 0.05,
      eyeSquint: amplitude * 0.03
    })),
    frame(t(4.3), duration - t(4.3), "easeOut", waitingSwayRestFrame())
  ];
}

function createWaitingTimeScaler(duration: number): (time: number) => number {
  const scale = duration / baseTemplateDurationSeconds;
  return (time: number) => time * scale;
}

function styledFrame(
  context: WaitingMotionContext,
  time: number,
  duration: number,
  easing: RuntimeExpressionKeyframe["easing"],
  facs: PartialFACSLikeState,
  styleWeight = 1
): RuntimeExpressionKeyframe {
  return frame(time, duration, easing, addFACS(facs, context.style.postureBias, styleWeight));
}

function frame(
  time: number,
  duration: number,
  easing: RuntimeExpressionKeyframe["easing"],
  facs: PartialFACSLikeState
): RuntimeExpressionKeyframe {
  return {
    time,
    duration: Math.max(0.2, duration),
    easing,
    facs
  };
}

function waitingSwayFrame(side: number, amplitude: number, phase: number): PartialFACSLikeState {
  const headZBase = phase === 1 ? 0.52 : phase === 2 ? 0.62 : 0.42;
  const bodyZBase = phase === 1 ? 0.42 : phase === 2 ? 0.5 : 0.34;

  return clampFACSState({
    headX: side * amplitude * 0.18,
    headY: amplitude * 0.1,
    headZ: side * amplitude * headZBase,
    bodyX: side * amplitude * 0.22,
    bodyY: amplitude * 0.16,
    bodyZ: side * amplitude * bodyZBase,
    gazeX: -side * amplitude * 0.2,
    gazeY: amplitude * 0.08,
    eyeSmile: amplitude * 0.16,
    browOuterUp: amplitude * 0.1,
    mouthSmile: amplitude * 0.16
  });
}

function waitingSwayRestFrame(): PartialFACSLikeState {
  return {
    browInnerUp: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    bodyX: 0,
    bodyY: 0,
    bodyZ: 0,
    gazeX: 0,
    gazeY: 0,
    eyeSmile: 0,
    eyeSquint: 0,
    browOuterUp: 0,
    mouthSmile: 0,
    blush: 0
  };
}
