import { clamp } from "../utils/clamp";
import { lerp } from "../utils/lerp";
import { clampFACSState } from "../facs/FACSUtils";
import { defaultFACSState } from "../facs/defaultFACSState";
import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";
import { getEmotionArchetype } from "../expression/EmotionArchetypeRegistry";
import type { VADVector } from "./VADState";

export interface VADExpressionResidue {
  emotion: string;
  facs: PartialFACSLikeState;
}

export interface VADExpressionMapperOptions {
  dominantEmotion?: string;
  residue?: VADExpressionResidue | null;
  styleGain?: number;
}

const directionalKeys = new Set<FACSKey>([
  "gazeX",
  "gazeY",
  "headX",
  "headY",
  "headZ",
  "bodyX",
  "bodyY",
  "bodyZ"
]);

export class VADExpressionMapper {
  toFACS(vad: VADVector, weight = 1, options: VADExpressionMapperOptions = {}): PartialFACSLikeState {
    const positive = Math.max(0, vad.valence);
    const negative = Math.max(0, -vad.valence);
    const aroused = Math.max(0, vad.arousal);
    const calm = Math.max(0, -vad.arousal);
    const submissive = Math.max(0, -vad.dominance);
    const dominant = Math.max(0, vad.dominance);

    const mouthSmile = positive * 0.13 + calm * positive * 0.05;
    const mouthFrown = negative * 0.1 + calm * negative * 0.04;
    const browInnerUp = negative * 0.08 + submissive * 0.055;
    const browOuterUp = aroused * 0.08 + positive * aroused * 0.035;
    const browDown = dominant * negative * 0.11;
    const eyeSmile = positive * 0.08 + calm * positive * 0.035;
    const eyeSquint = negative * dominant * 0.08 + calm * 0.035;
    const eyeOpen = clamp(1 + aroused * 0.08 - calm * 0.07 - negative * 0.035, 0.86, 1.12);

    const base = {
      mouthSmile: mouthSmile * weight,
      mouthFrown: mouthFrown * weight,
      browInnerUp: browInnerUp * weight,
      browOuterUp: browOuterUp * weight,
      browDown: browDown * weight,
      eyeSmile: eyeSmile * weight,
      eyeSquint: eyeSquint * weight,
      eyeOpen: 1 + (eyeOpen - 1) * weight,
      gazeY: (-submissive * 0.05 + dominant * 0.025) * weight,
      headY: (-submissive * 0.035 + dominant * 0.025 + aroused * 0.012) * weight,
      headZ: (positive * submissive * -0.025 + negative * dominant * 0.018) * weight,
      blush: positive * submissive * 0.16 * weight,
      sweat: negative * aroused * 0.1 * weight
    };

    const emotion = normalizeEmotionName(options.dominantEmotion);
    const intensity = vadMagnitude(vad);
    const styleGain = clamp(options.styleGain ?? 1, 0, 2.4);
    let result = this.applyStyle(
      base,
      this.getArchetypeStyle(emotion),
      emotion === "neutral" ? 0 : clamp((0.1 + intensity * 0.76) * weight * styleGain, 0, 0.46)
    );

    if (options.residue && isRelatedEmotion(emotion, normalizeEmotionName(options.residue.emotion))) {
      result = this.applyStyle(
        result,
        options.residue.facs,
        clamp((0.14 + intensity * 0.62) * weight * styleGain, 0, 0.58)
      );
    }

    return clampFACSState(result);
  }

  private getArchetypeStyle(emotion: string): PartialFACSLikeState {
    if (emotion === "neutral") return {};

    const archetype = getEmotionArchetype(emotion);
    const result: PartialFACSLikeState = {};

    for (const [key, range] of Object.entries(archetype.baseTendency) as Array<[FACSKey, [number, number]]>) {
      result[key] = (range[0] + range[1]) / 2;
    }

    return clampFACSState(result);
  }

  private applyStyle(
    base: PartialFACSLikeState,
    style: PartialFACSLikeState,
    amount: number
  ): PartialFACSLikeState {
    if (amount <= 0) return base;

    const result: PartialFACSLikeState = { ...base };

    for (const key of Object.keys(style) as FACSKey[]) {
      const target = style[key];
      if (typeof target !== "number") continue;

      const neutral = defaultFACSState[key];
      const current = result[key] ?? neutral;
      const styled = lerp(neutral, target, amount);

      if (directionalKeys.has(key) || key === "eyeOpen") {
        result[key] = current + (styled - neutral);
      } else {
        result[key] = Math.max(current, styled);
      }
    }

    return clampFACSState(result);
  }
}

function vadMagnitude(vad: VADVector): number {
  return clamp(
    (Math.abs(vad.valence) + Math.abs(vad.arousal) * 0.82 + Math.abs(vad.dominance) * 0.64) / 2.46,
    0,
    1
  );
}

function normalizeEmotionName(value?: string): string {
  const emotion = value?.trim() ?? "neutral";

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

function isRelatedEmotion(a: string, b: string): boolean {
  if (a === b) return true;
  if ((a === "happy" && b === "excited") || (a === "excited" && b === "happy")) return true;
  if ((a === "happy" && b === "affectionate") || (a === "affectionate" && b === "happy")) return true;
  if ((a === "sad" && b === "concerned") || (a === "concerned" && b === "sad")) return true;
  return false;
}
