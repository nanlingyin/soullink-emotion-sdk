import { clampFACSState } from "../facs/FACSUtils";
import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";
import { defaultFACSState } from "../facs/defaultFACSState";
import { evaluateExpressionTimeline } from "../expression/ExpressionTimeline";
import type { RuntimeExpressionKeyframe } from "../expression/EmotionArchetype";
import { clamp } from "../utils/clamp";
import { seededRandom, type RandomSource } from "../utils/seededRandom";
import type { VADRuntimeState, VADVector } from "./VADState";

export interface VADGestureOptions {
  enabled: boolean;
  bodyMotionGain?: number;
  frequency?: number;
  avoidRepeatWindow?: number;
}

export interface VADGestureState {
  activeLabel: string | null;
  recentLabels: string[];
  nextAllowedGestureAt: number;
}

interface ActiveVADGesture {
  label: string;
  startedAt: number;
  duration: number;
  frames: RuntimeExpressionKeyframe[];
}

interface GestureContext {
  emotion: string;
  vad: VADVector;
  delta: VADVector;
  intensity: number;
  amplitude: number;
  side: number;
  random: RandomSource;
  bodyMotionGain: number;
}

const neutralVAD: VADVector = {
  valence: 0,
  arousal: 0,
  dominance: 0
};

export class VADGestureController {
  private previousTarget: VADVector | null = null;
  private gesture: ActiveVADGesture | null = null;
  private random: RandomSource;
  private nextAllowedGestureAt = 0;
  private recentGestureLabels: string[] = [];

  constructor(private readonly seed = 7309) {
    this.random = seededRandom(seed);
  }

  reset() {
    this.previousTarget = null;
    this.gesture = null;
    this.nextAllowedGestureAt = 0;
    this.recentGestureLabels = [];
    this.random = seededRandom(this.seed);
  }

  getState(): VADGestureState {
    return {
      activeLabel: this.gesture?.label ?? null,
      recentLabels: [...this.recentGestureLabels],
      nextAllowedGestureAt: this.nextAllowedGestureAt
    };
  }

  update(timeSeconds: number, vad: VADRuntimeState, options: VADGestureOptions): PartialFACSLikeState {
    if (!options.enabled) {
      this.previousTarget = { ...vad.target };
      this.gesture = null;
      return {};
    }

    const bodyMotionGain = clamp(options.bodyMotionGain ?? 1, 0, 4);
    const frequency = clamp(options.frequency ?? 1, 0, 2.5);
    const repeatWindow = Math.round(clamp(options.avoidRepeatWindow ?? 3, 0, 8));
    const delta = this.getTargetDelta(vad.target);
    this.maybeStartGesture(timeSeconds, vad, delta, bodyMotionGain, frequency, repeatWindow);
    this.previousTarget = { ...vad.target };

    return this.evaluateGesture(timeSeconds);
  }

  private getTargetDelta(target: VADVector): VADVector {
    const previous = this.previousTarget ?? neutralVAD;
    return {
      valence: target.valence - previous.valence,
      arousal: target.arousal - previous.arousal,
      dominance: target.dominance - previous.dominance
    };
  }

  private maybeStartGesture(
    timeSeconds: number,
    vad: VADRuntimeState,
    delta: VADVector,
    bodyMotionGain: number,
    frequency: number,
    repeatWindow: number
  ) {
    const deltaAmount = vadMagnitude(delta);
    const currentAmount = vadMagnitude(vad.current);
    const targetAmount = vadMagnitude(vad.target);
    const triggerAmount = Math.max(deltaAmount, Math.abs(targetAmount - currentAmount) * 0.72);

    if (frequency <= 0 || triggerAmount < 0.06 / Math.max(0.6, frequency)) return;
    if (timeSeconds < this.nextAllowedGestureAt) return;
    if (this.gesture && timeSeconds - this.gesture.startedAt < this.gesture.duration * 0.58) return;

    const seed = Math.round(
      timeSeconds * 997
      + vad.target.valence * 701
      + vad.target.arousal * 503
      + vad.target.dominance * 307
      + this.random() * 100000
    );
    const random = seededRandom(seed);
    const side = random() < 0.5 ? -1 : 1;
    const amplitude = clamp((0.16 + triggerAmount * 1.08 + targetAmount * 0.32) * (0.9 + random() * 0.46), 0.16, 0.72);
    const emotion = normalizeGestureEmotion(vad.dominantEmotion, vad.target);
    const context: GestureContext = {
      emotion,
      vad: vad.target,
      delta,
      intensity: targetAmount,
      amplitude,
      side,
      random,
      bodyMotionGain
    };
    const next = buildGesture(context, timeSeconds, this.recentGestureLabels);

    this.gesture = next;
    if (repeatWindow > 0) {
      this.recentGestureLabels.push(next.label);
      this.recentGestureLabels = this.recentGestureLabels.slice(-repeatWindow);
    } else {
      this.recentGestureLabels = [];
    }
    const frequencyScale = 1 / Math.sqrt(Math.max(0.35, frequency));
    this.nextAllowedGestureAt = timeSeconds + next.duration + (0.72 + random() * 1.6) * frequencyScale;
  }

  private evaluateGesture(timeSeconds: number): PartialFACSLikeState {
    if (!this.gesture) return {};

    const elapsed = timeSeconds - this.gesture.startedAt;
    if (elapsed >= this.gesture.duration) {
      this.gesture = null;
      return {};
    }

    return evaluateExpressionTimeline(this.gesture.frames, elapsed);
  }
}

function buildGesture(context: GestureContext, timeSeconds: number, recentLabels: string[]): ActiveVADGesture {
  const family = pickGestureFamily(context, recentLabels);
  const duration = 0.96 + context.random() * 0.58 + context.intensity * 0.45;
  const attack = 0.2 + context.random() * 0.16;
  const settleStart = attack * (0.78 + context.random() * 0.24);
  const returnStart = duration * (0.52 + context.random() * 0.16);
  const peak = gesturePeak(family, context);
  const settle = scaleGesture(peak, 0.48 + context.random() * 0.24);
  const rest = gestureRestFrame(peak);

  return {
    label: family,
    startedAt: timeSeconds,
    duration,
    frames: [
      {
        time: 0,
        duration: attack,
        easing: "easeOut",
        facs: peak
      },
      {
        time: settleStart,
        duration: Math.max(0.16, duration * 0.28),
        easing: "easeInOut",
        facs: settle
      },
      {
        time: returnStart,
        duration: Math.max(0.22, duration - returnStart),
        easing: "easeOut",
        facs: rest
      }
    ]
  };
}

function pickGestureFamily(context: GestureContext, recentLabels: string[]): string {
  const emotion = context.emotion;
  let candidates: Array<[string, number]>;

  if (emotion === "shy" || emotion === "anxiety") {
    candidates = [["shy-dip", 0.44], ["side-glance", 0.31], ["soft-sink", 0.15], ["warm-sway", 0.1]];
  } else if (emotion === "curious" || emotion === "confused") {
    candidates = [["curious-tilt", 0.44], ["small-lean-in", 0.3], ["side-glance", 0.15], ["quick-nod", 0.11]];
  } else if (emotion === "surprised" || emotion === "excited") {
    candidates = [["bright-pop", 0.42], ["quick-nod", 0.34], ["curious-tilt", 0.14], ["warm-sway", 0.1]];
  } else if (emotion === "anger" || emotion === "annoyed") {
    candidates = [["firm-lean", 0.42], ["side-set", 0.34], ["slow-glance-down", 0.13], ["small-lean-in", 0.11]];
  } else if (emotion === "sad" || emotion === "concerned") {
    candidates = [["soft-sink", 0.42], ["slow-glance-down", 0.32], ["side-glance", 0.15], ["warm-sway", 0.11]];
  } else if (emotion === "happy" || emotion === "affectionate") {
    candidates = [["quick-nod", 0.38], ["warm-sway", 0.36], ["small-lean-in", 0.15], ["shy-dip", 0.11]];
  } else if (emotion === "calm") {
    candidates = [["warm-sway", 0.44], ["small-lean-in", 0.25], ["side-glance", 0.17], ["soft-sink", 0.14]];
  } else {
    candidates = [["warm-sway", 0.34], ["curious-tilt", 0.3], ["side-glance", 0.2], ["quick-nod", 0.16]];
  }

  const fresh = candidates.filter(([label]) => !recentLabels.includes(label));
  const pool = fresh.length > 0 ? fresh : candidates;
  const weighted = pool.map(([label, weight]) => ({ label, weight }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = context.random() * total;

  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.label;
  }

  return weighted[0].label;
}

function gesturePeak(family: string, context: GestureContext): PartialFACSLikeState {
  const a = context.amplitude;
  const side = context.side;
  const gain = context.bodyMotionGain;
  const positive = Math.max(0, context.vad.valence);
  const negative = Math.max(0, -context.vad.valence);
  const aroused = Math.max(0, context.vad.arousal);
  const submissive = Math.max(0, -context.vad.dominance);
  const dominant = Math.max(0, context.vad.dominance);

  const body = (value: number) => value * gain * 1.24;

  if (family === "quick-nod") {
    return clampFACSState({
      headY: body(a * (0.42 + aroused * 0.18)),
      headZ: side * body(a * 0.18),
      bodyY: body(a * 0.28),
      bodyZ: side * body(a * 0.16),
      gazeY: a * 0.1,
      eyeSmile: a * (0.36 + positive * 0.24),
      mouthSmile: a * (0.42 + positive * 0.22),
      browOuterUp: a * 0.14
    });
  }

  if (family === "warm-sway") {
    return clampFACSState({
      headX: side * body(a * 0.22),
      headZ: side * body(a * 0.36),
      bodyX: side * body(a * 0.24),
      bodyZ: side * body(a * 0.3),
      gazeX: -side * a * 0.14,
      eyeSmile: a * 0.32,
      mouthSmile: a * 0.34,
      blush: positive * submissive * a * 0.42
    });
  }

  if (family === "shy-dip") {
    return clampFACSState({
      headY: -body(a * 0.48),
      headZ: -side * body(a * 0.42),
      bodyX: side * body(a * 0.12),
      bodyY: -body(a * 0.18),
      bodyZ: -side * body(a * 0.28),
      gazeX: side * a * 0.22,
      gazeY: -a * 0.32,
      browInnerUp: a * 0.24,
      eyeSmile: a * 0.18,
      blush: a * (0.32 + submissive * 0.34),
      mouthSmile: a * 0.18
    });
  }

  if (family === "side-glance") {
    return clampFACSState({
      headX: side * body(a * 0.18),
      headZ: -side * body(a * 0.28),
      bodyZ: -side * body(a * 0.18),
      gazeX: side * a * 0.46,
      gazeY: -a * 0.18,
      browInnerUp: a * 0.2,
      eyeSquint: a * 0.12,
      blush: a * 0.22
    });
  }

  if (family === "curious-tilt") {
    return clampFACSState({
      headX: side * body(a * 0.2),
      headY: body(a * 0.12),
      headZ: side * body(a * 0.62),
      bodyX: side * body(a * 0.1),
      bodyY: body(a * 0.16),
      gazeX: side * a * 0.26,
      gazeY: a * 0.12,
      browOuterUp: a * 0.28,
      eyeSquint: a * 0.1
    });
  }

  if (family === "small-lean-in") {
    return clampFACSState({
      headY: body(a * 0.2),
      headZ: side * body(a * 0.22),
      bodyY: body(a * 0.38),
      bodyZ: side * body(a * 0.14),
      gazeY: a * 0.14,
      browOuterUp: a * 0.18,
      eyeSmile: positive * a * 0.22,
      mouthSmile: positive * a * 0.24
    });
  }

  if (family === "bright-pop") {
    return clampFACSState({
      headY: body(a * 0.34),
      headZ: side * body(a * 0.22),
      bodyY: body(a * 0.36),
      bodyZ: side * body(a * 0.2),
      gazeY: a * 0.2,
      browOuterUp: a * 0.42,
      eyeSmile: positive * a * 0.24,
      mouthSmile: positive * a * 0.36,
      sweat: negative * aroused * a * 0.18
    });
  }

  if (family === "firm-lean") {
    return clampFACSState({
      headY: body(a * 0.22),
      headZ: side * body(a * 0.2),
      bodyY: body(a * 0.42),
      bodyZ: side * body(a * 0.16),
      gazeY: a * 0.12,
      browDown: a * (0.32 + dominant * 0.28),
      eyeSquint: a * 0.2,
      mouthFrown: a * 0.22
    });
  }

  if (family === "side-set") {
    return clampFACSState({
      headX: -side * body(a * 0.18),
      headZ: side * body(a * 0.34),
      bodyZ: side * body(a * 0.24),
      gazeX: -side * a * 0.26,
      browDown: a * 0.24,
      eyeSquint: a * 0.18,
      mouthFrown: a * 0.16
    });
  }

  if (family === "soft-sink") {
    return clampFACSState({
      headY: -body(a * 0.34),
      headZ: side * body(a * 0.16),
      bodyY: -body(a * 0.24),
      gazeY: -a * 0.34,
      browInnerUp: a * 0.28,
      mouthFrown: a * (0.22 + negative * 0.16)
    });
  }

  return clampFACSState({
    headY: -body(a * 0.22),
    bodyY: -body(a * 0.18),
    gazeY: -a * 0.42,
    browInnerUp: a * 0.22,
    eyeSquint: a * 0.12,
    mouthFrown: a * 0.14
  });
}

function scaleGesture(facs: PartialFACSLikeState, scale: number): PartialFACSLikeState {
  const result: PartialFACSLikeState = {};

  for (const [key, value] of Object.entries(facs) as Array<[FACSKey, number | undefined]>) {
    if (typeof value !== "number") continue;
    result[key] = value * scale;
  }

  return clampFACSState(result);
}

function gestureRestFrame(facs: PartialFACSLikeState): PartialFACSLikeState {
  const result: PartialFACSLikeState = {};

  for (const key of Object.keys(facs) as FACSKey[]) {
    result[key] = key === "breath" ? defaultFACSState.breath : 0;
  }

  return result;
}

function normalizeGestureEmotion(value: string | undefined, vad: VADVector): string {
  const emotion = value?.trim() ?? "neutral";

  if (emotion === "soft-happy" || emotion === "soft-positive") return "happy";
  if (emotion === "soft-calm") return "calm";
  if (emotion === "soft-curious") return "curious";
  if (emotion === "soft-shy") return "shy";
  if (emotion === "soft-uneasy") return "anxiety";
  if (emotion === "soft-low") return "sad";
  if (emotion === "soft-steady") return "neutral";
  if (emotion === "angry") return "anger";
  if (emotion !== "neutral") return emotion;

  if (vad.valence > 0.22 && vad.dominance < -0.18) return "shy";
  if (vad.valence > 0.2 && vad.arousal > 0.24) return "happy";
  if (vad.valence < -0.24 && vad.arousal > 0.18) return vad.dominance > 0.1 ? "anger" : "anxiety";
  if (vad.valence < -0.18) return "sad";
  if (vad.arousal > 0.18) return "curious";
  if (vad.arousal < -0.18) return "calm";

  return "neutral";
}

function vadMagnitude(vad: VADVector): number {
  return clamp(
    (Math.abs(vad.valence) + Math.abs(vad.arousal) * 0.82 + Math.abs(vad.dominance) * 0.64) / 2.46,
    0,
    1
  );
}
