import { clamp } from "../utils/clamp";
import { ease } from "../utils/easing";
import { defaultFACSState } from "../facs/defaultFACSState";
import { clampFACSState } from "../facs/FACSUtils";
import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";
import type { VADVector } from "./VADState";

export interface ReflectionPulseInput {
  emotion?: string;
  vadTarget?: Partial<VADVector>;
  intensity?: number;
  seed?: number;
}

interface ReflectionPulse {
  startedAt: number;
  duration: number;
  attack: number;
  hold: number;
  facs: PartialFACSLikeState;
  seed: number;
}

export class ReflectionPulseController {
  private pulse: ReflectionPulse | null = null;

  start(input: ReflectionPulseInput, timeSeconds: number) {
    const emotion = normalizeEmotion(input.emotion ?? inferEmotionFromVAD(input.vadTarget));
    if (emotion === "neutral") return;

    const intensity = clamp(input.intensity ?? intensityFromVAD(input.vadTarget), 0.22, 0.94);
    const seed = input.seed ?? Math.round(timeSeconds * 997) % 1000000;
    const duration = 2.65 + intensity * 2.15 + ((seed % 17) / 17) * 0.65;

    this.pulse = {
      startedAt: timeSeconds,
      duration,
      attack: 0.42 + intensity * 0.24,
      hold: 0.86 + intensity * 0.82,
      facs: createPulseFACS(emotion, intensity, seed),
      seed
    };
  }

  update(timeSeconds: number): PartialFACSLikeState {
    if (!this.pulse) return {};

    const elapsed = timeSeconds - this.pulse.startedAt;
    if (elapsed < 0) return {};
    if (elapsed >= this.pulse.duration) {
      this.pulse = null;
      return {};
    }

    const envelope = this.envelope(elapsed, this.pulse);
    const living = Math.sin(timeSeconds * 2.1 + this.pulse.seed * 0.017) * 0.035 * envelope;
    const result: PartialFACSLikeState = {};

    for (const key of Object.keys(this.pulse.facs) as FACSKey[]) {
      const target = this.pulse.facs[key];
      if (typeof target !== "number") continue;

      const neutral = defaultFACSState[key];
      let value = neutral + (target - neutral) * envelope;

      if (key === "blush" || key === "eyeSmile" || key === "mouthSmile") value += Math.max(0, living);
      if (key === "gazeX" || key === "headZ") value += living * 0.7;

      result[key] = value;
    }

    return clampFACSState(result);
  }

  reset() {
    this.pulse = null;
  }

  private envelope(elapsed: number, pulse: ReflectionPulse): number {
    if (elapsed <= pulse.attack) return ease("easeOut", elapsed / pulse.attack);
    if (elapsed <= pulse.attack + pulse.hold) return 1;

    const releaseDuration = Math.max(0.001, pulse.duration - pulse.attack - pulse.hold);
    return 1 - ease("easeInOut", (elapsed - pulse.attack - pulse.hold) / releaseDuration);
  }
}

function createPulseFACS(emotion: string, intensity: number, seed: number): PartialFACSLikeState {
  const side = seed % 2 === 0 ? -1 : 1;

  if (emotion === "shy") {
    return {
      blush: 0.34 + intensity * 0.46,
      eyeSmile: 0.12 + intensity * 0.18,
      mouthSmile: 0.12 + intensity * 0.2,
      browInnerUp: 0.04 + intensity * 0.1,
      gazeX: side * (0.14 + intensity * 0.2),
      gazeY: -0.08 - intensity * 0.1,
      headZ: side * (0.04 + intensity * 0.1),
      headY: -0.02 - intensity * 0.04
    };
  }

  if (emotion === "happy" || emotion === "excited") {
    return {
      mouthSmile: 0.18 + intensity * 0.28,
      eyeSmile: 0.1 + intensity * 0.18,
      browOuterUp: emotion === "excited" ? 0.08 + intensity * 0.14 : 0.04,
      mouthOpen: emotion === "excited" ? 0.04 + intensity * 0.1 : 0.02,
      headZ: side * (0.03 + intensity * 0.04),
      bodyY: emotion === "excited" ? 0.02 + intensity * 0.04 : 0
    };
  }

  if (emotion === "affectionate") {
    return {
      mouthSmile: 0.14 + intensity * 0.24,
      eyeSmile: 0.12 + intensity * 0.2,
      browInnerUp: 0.06 + intensity * 0.12,
      blush: 0.1 + intensity * 0.22,
      gazeY: 0.02 + intensity * 0.04,
      headZ: side * (0.02 + intensity * 0.05)
    };
  }

  if (emotion === "curious" || emotion === "confused") {
    return {
      browOuterUp: 0.08 + intensity * 0.22,
      browInnerUp: 0.04 + intensity * 0.12,
      eyeOpen: 1.01 + intensity * 0.08,
      mouthOpen: 0.02 + intensity * 0.1,
      headZ: side * (0.08 + intensity * 0.1),
      gazeX: side * (0.04 + intensity * 0.1)
    };
  }

  if (emotion === "sad" || emotion === "concerned" || emotion === "anxiety") {
    return {
      browInnerUp: 0.12 + intensity * 0.28,
      mouthFrown: emotion === "concerned" ? 0.05 + intensity * 0.08 : 0.08 + intensity * 0.18,
      mouthSmile: emotion === "concerned" ? 0.04 + intensity * 0.08 : 0,
      gazeY: -0.06 - intensity * 0.12,
      headY: -0.03 - intensity * 0.08,
      headZ: side * (0.02 + intensity * 0.06),
      tear: emotion === "sad" ? intensity * 0.16 : 0,
      sweat: emotion === "anxiety" ? 0.06 + intensity * 0.18 : 0
    };
  }

  if (emotion === "anger") {
    return {
      browDown: 0.12 + intensity * 0.28,
      eyeSquint: 0.08 + intensity * 0.14,
      mouthFrown: 0.1 + intensity * 0.18,
      headY: 0.02 + intensity * 0.04
    };
  }

  if (emotion === "surprised") {
    return {
      eyeOpen: 1.04 + intensity * 0.14,
      browOuterUp: 0.14 + intensity * 0.26,
      mouthOpen: 0.08 + intensity * 0.22,
      headY: -0.04
    };
  }

  return {
    mouthSmile: 0.08,
    browInnerUp: 0.05
  };
}

function normalizeEmotion(emotion: string): string {
  if (emotion === "soft-happy" || emotion === "soft-positive") return "happy";
  if (emotion === "soft-calm") return "calm";
  if (emotion === "soft-curious") return "curious";
  if (emotion === "soft-shy") return "shy";
  if (emotion === "soft-uneasy") return "anxiety";
  if (emotion === "soft-low") return "sad";
  if (emotion === "soft-steady") return "neutral";
  if (emotion === "angry") return "anger";
  return emotion;
}

function inferEmotionFromVAD(vad?: Partial<VADVector>): string {
  if (!vad) return "neutral";

  const valence = vad.valence ?? 0;
  const arousal = vad.arousal ?? 0;
  const dominance = vad.dominance ?? 0;

  if (valence > 0.12 && dominance < -0.22) return "shy";
  if (valence < -0.34 && arousal > 0.38 && dominance < -0.12) return "anxiety";
  if (valence < -0.42 && arousal > 0.42 && dominance > 0.18) return "anger";
  if (valence > 0.58 && arousal > 0.62) return "excited";
  if (valence > 0.25) return "happy";
  if (valence < -0.42 && arousal < -0.2) return "sad";
  if (valence < -0.08) return "concerned";
  if (arousal > 0.48) return "surprised";
  if (arousal > 0.22) return "curious";

  return "neutral";
}

function intensityFromVAD(vad?: Partial<VADVector>): number {
  if (!vad) return 0.35;

  return clamp(
    (Math.abs(vad.valence ?? 0) + Math.abs(vad.arousal ?? 0) * 0.82 + Math.abs(vad.dominance ?? 0) * 0.64) / 2.46,
    0.22,
    0.78
  );
}
