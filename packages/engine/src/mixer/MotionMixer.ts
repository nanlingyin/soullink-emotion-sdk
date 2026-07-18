import { clampFACSState, facsKeys } from "../facs/FACSUtils";
import { createDefaultFACSState } from "../facs/defaultFACSState";
import type { FACSKey, FACSLikeState, PartialFACSLikeState } from "../facs/FACSLikeState";
import { additiveFACSKeys, maxFACSKeys } from "./PriorityRules";

export interface MotionMixerInput {
  idle?: PartialFACSLikeState;
  emotion?: PartialFACSLikeState;
  reaction?: PartialFACSLikeState;
  speech?: PartialFACSLikeState;
  manual?: PartialFACSLikeState;
}

export class MotionMixer {
  mix(input: MotionMixerInput): FACSLikeState {
    let result = createDefaultFACSState();

    result = this.applyLayer(result, input.idle, "idle");
    result = this.applyLayer(result, input.emotion, "emotion");
    result = this.applyLayer(result, input.reaction, "reaction");
    result = this.applyLayer(result, input.speech, "speech");
    result = this.applyLayer(result, input.manual, "manual");

    return clampFACSState(result) as FACSLikeState;
  }

  private applyLayer(
    base: FACSLikeState,
    layer: PartialFACSLikeState | undefined,
    mode: "idle" | "emotion" | "reaction" | "speech" | "manual"
  ): FACSLikeState {
    if (!layer) return base;

    const result: FACSLikeState = { ...base };
    for (const key of facsKeys) {
      const value = layer[key];
      if (typeof value !== "number") continue;

      if (mode === "manual") {
        result[key] = value;
      } else if (mode === "speech") {
        if (key === "mouthOpen") {
          result[key] = Math.max(result[key], value);
        } else if (key === "browOuterUp") {
          result[key] += value;
        } else if (additiveFACSKeys.has(key)) {
          result[key] += value;
        }
      } else if (mode === "idle") {
        if (key === "breath") {
          result[key] = value;
        } else if (additiveFACSKeys.has(key) || key === "mouthSmile" || key === "browInnerUp") {
          result[key] += value;
        } else {
          result[key] = value;
        }
      } else if (mode === "emotion") {
        if (key === "breath") {
          result[key] = Math.max(result[key], value);
        } else if (additiveFACSKeys.has(key) || key === "mouthSmile" || key === "mouthFrown" || key.startsWith("brow")) {
          result[key] += value;
        } else if (maxFACSKeys.has(key)) {
          result[key] = Math.max(result[key], value);
        } else {
          result[key] = value;
        }
      } else if (mode === "reaction") {
        if (maxFACSKeys.has(key)) {
          result[key] = Math.max(result[key], value);
        } else if (additiveFACSKeys.has(key)) {
          result[key] += value;
        } else {
          result[key] = value;
        }
      }
    }

    return clampFACSState(result) as FACSLikeState;
  }
}
