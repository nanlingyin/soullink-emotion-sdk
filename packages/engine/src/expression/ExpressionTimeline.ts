import { ease } from "../utils/easing";
import { clampFACSState } from "../facs/FACSUtils";
import { defaultFACSState } from "../facs/defaultFACSState";
import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";
import type { RuntimeExpressionKeyframe } from "./EmotionArchetype";
import { lerp } from "../utils/lerp";

export function getTimelineDuration(timeline: RuntimeExpressionKeyframe[]): number {
  return timeline.reduce((max, frame) => Math.max(max, frame.time + frame.duration), 0);
}

export function evaluateExpressionTimeline(
  timeline: RuntimeExpressionKeyframe[],
  elapsedSeconds: number
): PartialFACSLikeState {
  let result: PartialFACSLikeState = {};

  for (const frame of timeline) {
    if (elapsedSeconds < frame.time) continue;

    const local = frame.duration <= 0 ? 1 : (elapsedSeconds - frame.time) / frame.duration;
    const weight = frame.weight ?? 1;
    const eased = ease(frame.easing, Math.min(1, local));
    result = blendFrame(result, frame.facs, eased, weight);
  }

  return result;
}

function blendFrame(
  current: PartialFACSLikeState,
  target: PartialFACSLikeState,
  progress: number,
  weight: number
): PartialFACSLikeState {
  const result = { ...current };

  for (const key of Object.keys(target) as FACSKey[]) {
    const targetValue = target[key];
    if (typeof targetValue !== "number") continue;

    const neutralValue = defaultFACSState[key];
    const weightedTarget = lerp(neutralValue, targetValue, weight);
    const fromValue = current[key] ?? neutralValue;
    result[key] = lerp(fromValue, weightedTarget, progress);
  }

  return clampFACSState(result);
}
