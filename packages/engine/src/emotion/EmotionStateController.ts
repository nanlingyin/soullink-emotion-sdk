import { clamp } from "../utils/clamp";
import { lerp } from "../utils/lerp";
import { seededRandom } from "../utils/seededRandom";
import type { EmotionIntent } from "../reaction/EmotionIntent";
import { emotionVADPresets, getVADPreset, neutralVAD } from "./EmotionPresetRegistry";
import type { VADRuntimeState, VADVector } from "./VADState";

export interface EmotionPersonality {
  baseline?: Partial<VADVector>;
  reactivity?: number;
  targetApproachRate?: number;
  decayRate?: number;
  emotionHoldSeconds?: number;
  emotionBias?: Partial<Record<string, number>>;
  ambientDriftStrength?: number;
}

function clampVAD(vector: VADVector): VADVector {
  return {
    valence: clamp(vector.valence, -1, 1),
    arousal: clamp(vector.arousal, -1, 1),
    dominance: clamp(vector.dominance, -1, 1)
  };
}

function lerpVAD(from: VADVector, to: VADVector, amount: number): VADVector {
  return clampVAD({
    valence: lerp(from.valence, to.valence, amount),
    arousal: lerp(from.arousal, to.arousal, amount),
    dominance: lerp(from.dominance, to.dominance, amount)
  });
}

function magnitude(vector: VADVector): number {
  return clamp(
    (Math.abs(vector.valence) + Math.abs(vector.arousal) * 0.82 + Math.abs(vector.dominance) * 0.64) / 2.46,
    0,
    1
  );
}

function nearestVADPreset(vad: VADVector): string {
  const candidates = Object.entries(emotionVADPresets)
    .filter(([emotion]) => emotion !== "neutral" && emotion !== "angry");
  let bestEmotion = "neutral";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [emotion, preset] of candidates) {
    const distance = weightedVADDistance(vad, preset);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestEmotion = emotion;
    }
  }

  return bestDistance < 0.92 ? bestEmotion : "neutral";
}

function weightedVADDistance(a: VADVector, b: VADVector): number {
  const valence = a.valence - b.valence;
  const arousal = a.arousal - b.arousal;
  const dominance = a.dominance - b.dominance;

  return valence * valence * 1.08
    + arousal * arousal * 0.88
    + dominance * dominance * 1.28;
}

export class EmotionStateController {
  private current: VADVector = { ...neutralVAD };
  private target: VADVector = { ...neutralVAD };
  private baseline: VADVector = { ...neutralVAD };
  private ambientDrift: VADVector = { ...neutralVAD };
  private ambientTarget: VADVector = { valence: 0.018, arousal: -0.012, dominance: 0.01 };
  private ambientDriftStrength = 0.034;
  private driftClock = 0;
  private nextDriftAt = 0;
  private random = seededRandom(9137);
  private reactivity = 1;
  private targetApproachRate = 1.35;
  private decayRate = 0.018;
  private emotionHoldSeconds = 18;
  private holdRemainingSeconds = 0;
  private emotionBias: Partial<Record<string, number>> = {};
  private dominantEmotion = "neutral";

  constructor(personality: EmotionPersonality = {}) {
    this.configure(personality);
    this.reset();
  }

  configure(personality: EmotionPersonality) {
    if (personality.baseline) {
      this.setBaseline(personality.baseline);
    }

    if (typeof personality.reactivity === "number") {
      this.reactivity = clamp(personality.reactivity, 0.2, 2.5);
    }

    if (typeof personality.targetApproachRate === "number") {
      this.targetApproachRate = clamp(personality.targetApproachRate, 0.2, 4);
    }

    if (typeof personality.decayRate === "number") {
      this.decayRate = clamp(personality.decayRate, 0.002, 0.4);
    }

    if (typeof personality.emotionHoldSeconds === "number") {
      this.emotionHoldSeconds = clamp(personality.emotionHoldSeconds, 0, 90);
    }

    if (personality.emotionBias) {
      this.emotionBias = { ...this.emotionBias, ...personality.emotionBias };
    }

    if (typeof personality.ambientDriftStrength === "number") {
      this.ambientDriftStrength = clamp(personality.ambientDriftStrength, 0, 0.09);
    }
  }

  getDecayRate(): number {
    return this.decayRate;
  }

  setBaseline(baseline: Partial<VADVector>) {
    this.baseline = clampVAD({
      ...this.baseline,
      ...this.completeVAD(baseline, this.baseline)
    });
  }

  nudge(intent: EmotionIntent) {
    const naturalEmotion = intent.naturalEmotion ?? intent.emotion;
    const naturalVariant = intent.naturalVariant ?? intent.variant;
    const preset = intent.naturalVAD
      ? this.completeVAD(intent.naturalVAD, getVADPreset(naturalEmotion, naturalVariant))
      : getVADPreset(naturalEmotion, naturalVariant);
    const bias = this.emotionBias[naturalEmotion] ?? this.emotionBias[naturalVariant ?? ""] ?? 1;
    const amount = clamp((0.28 + intent.intensity * 0.58) * this.reactivity * bias, 0, 0.96);
    this.target = lerpVAD(this.target, preset, amount);
    this.extendHold(6 + intent.intensity * this.emotionHoldSeconds);
    this.dominantEmotion = naturalVariant?.includes("shy") ? "shy" : naturalEmotion;
  }

  blendTo(target: Partial<VADVector>, amount = 0.65) {
    const clampedAmount = clamp(amount, 0, 1);
    this.target = lerpVAD(this.target, this.completeVAD(target, this.target), clampedAmount);
    this.extendHold(4 + clampedAmount * this.emotionHoldSeconds);
  }

  nudgeVAD(delta: Partial<VADVector>, amount = 1) {
    const gain = clamp(amount * this.reactivity, 0, 2);
    this.target = clampVAD({
      valence: this.target.valence + (delta.valence ?? 0) * gain,
      arousal: this.target.arousal + (delta.arousal ?? 0) * gain,
      dominance: this.target.dominance + (delta.dominance ?? 0) * gain
    });
    this.extendHold(3 + clamp(amount, 0, 1.5) * this.emotionHoldSeconds * 0.55);
  }

  reset() {
    this.current = { ...this.baseline };
    this.target = { ...this.baseline };
    this.ambientDrift = { ...neutralVAD };
    this.ambientTarget = this.pickAmbientTarget();
    this.driftClock = 0;
    this.nextDriftAt = 0.8 + this.random() * 2.1;
    this.holdRemainingSeconds = 0;
    this.dominantEmotion = "neutral";
  }

  update(deltaSeconds: number): VADRuntimeState {
    const approach = 1 - Math.exp(-deltaSeconds * this.targetApproachRate);
    const decay = this.holdRemainingSeconds > 0 ? 0 : 1 - Math.exp(-deltaSeconds * this.decayRate);
    this.updateAmbientDrift(deltaSeconds);
    this.holdRemainingSeconds = Math.max(0, this.holdRemainingSeconds - deltaSeconds);

    this.current = lerpVAD(this.current, this.withAmbientDrift(this.target), approach);
    this.target = lerpVAD(this.target, this.baseline, decay);

    const currentMagnitude = magnitude(this.current);

    if (currentMagnitude < 0.0018) {
      this.dominantEmotion = "neutral";
    } else if (currentMagnitude < 0.08) {
      this.dominantEmotion = this.inferSubtleEmotion(this.current);
    } else {
      this.dominantEmotion = this.inferDominantEmotion(this.current);
    }

    return {
      current: this.current,
      target: this.target,
      dominantEmotion: this.dominantEmotion,
      intensity: currentMagnitude,
      ambient: this.ambientDrift,
      holdSeconds: this.holdRemainingSeconds,
      decayRate: this.decayRate
    };
  }

  private inferDominantEmotion(vad: VADVector): string {
    const valence = vad.valence;
    const arousal = vad.arousal;
    const dominance = vad.dominance;

    if (valence > 0.12 && dominance < -0.22) return "shy";
    if (valence < -0.34 && arousal > 0.38 && dominance < -0.12) return "anxiety";
    if (valence < -0.42 && arousal > 0.42 && dominance > 0.18) return "anger";
    if (valence > 0.58 && arousal > 0.62) return "excited";
    if (valence > 0.2 && arousal < -0.24) return "calm";

    return nearestVADPreset(vad);
  }

  private inferSubtleEmotion(vad: VADVector): string {
    if (vad.valence > 0.004 && vad.arousal > 0.004) return "soft-happy";
    if (vad.valence > 0.004 && vad.arousal < -0.004) return "soft-calm";
    if (vad.valence > 0.004) return "soft-positive";
    if (vad.valence < -0.004 && vad.arousal > 0.004) return "soft-uneasy";
    if (vad.valence < -0.004) return "soft-low";
    if (vad.arousal > 0.004) return "soft-curious";
    if (vad.arousal < -0.004) return "soft-calm";
    if (vad.dominance < -0.004) return "soft-shy";
    if (vad.dominance > 0.004) return "soft-steady";
    return "neutral";
  }

  private updateAmbientDrift(deltaSeconds: number) {
    if (this.ambientDriftStrength <= 0) return;

    this.driftClock += deltaSeconds;

    if (this.driftClock >= this.nextDriftAt) {
      this.ambientTarget = this.pickAmbientTarget();
      this.nextDriftAt = this.driftClock + 1.7 + this.random() * 4.2;
    }

    const approach = 1 - Math.exp(-deltaSeconds * 0.62);
    this.ambientDrift = lerpVAD(this.ambientDrift, this.ambientTarget, approach);
  }

  private pickAmbientTarget(): VADVector {
    const strength = this.ambientDriftStrength;
    const centerBias = this.random() < 0.26 ? 0.42 : 1;
    const pick = (axisScale: number) => {
      const half = strength * axisScale * centerBias;
      return -half + this.random() * half * 2;
    };

    return clampVAD({
      valence: pick(1),
      arousal: pick(0.82),
      dominance: pick(0.68)
    });
  }

  private withAmbientDrift(vector: VADVector): VADVector {
    return clampVAD({
      valence: vector.valence + this.ambientDrift.valence,
      arousal: vector.arousal + this.ambientDrift.arousal,
      dominance: vector.dominance + this.ambientDrift.dominance
    });
  }

  private extendHold(durationSeconds: number) {
    this.holdRemainingSeconds = Math.max(this.holdRemainingSeconds, durationSeconds);
  }

  private completeVAD(value: Partial<VADVector>, fallback: VADVector): VADVector {
    return clampVAD({
      valence: value.valence ?? fallback.valence,
      arousal: value.arousal ?? fallback.arousal,
      dominance: value.dominance ?? fallback.dominance
    });
  }
}
