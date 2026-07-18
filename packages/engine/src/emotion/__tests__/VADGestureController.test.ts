import { describe, expect, it } from "vitest";
import { facsRangeForKey } from "../../facs/FACSUtils";
import type { FACSKey } from "../../facs/FACSLikeState";
import type { VADRuntimeState } from "../VADState";
import { VADGestureController } from "../VADGestureController";

describe("VADGestureController", () => {
  it("is reproducible and avoids all labels in the recent window", () => {
    const first = collectLabels(new VADGestureController(913));
    const second = collectLabels(new VADGestureController(913));

    expect(first).toEqual(second);
    expect(new Set(first.slice(0, 4)).size).toBe(4);
    for (let index = 1; index < first.length; index += 1) {
      expect(first[index]).not.toBe(first[index - 1]);
    }
  });

  it("keeps every generated channel inside its FACS range", () => {
    const controller = new VADGestureController(21);
    const vad = state(0.8);
    controller.update(0, vad, { enabled: true, bodyMotionGain: 4 });
    const layer = controller.update(0.3, vad, { enabled: true, bodyMotionGain: 4 });

    for (const [rawKey, value] of Object.entries(layer)) {
      const key = rawKey as FACSKey;
      const [min, max] = facsRangeForKey(key);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  });
});

function collectLabels(controller: VADGestureController): string[] {
  const labels: string[] = [];

  for (let index = 0; index < 6; index += 1) {
    controller.update(index * 10, state(index % 2 === 0 ? 0.8 : -0.8), {
      enabled: true,
      frequency: 1,
      avoidRepeatWindow: 3
    });
    const label = controller.getState().activeLabel;
    if (label) labels.push(label);
  }

  return labels;
}

function state(valence: number): VADRuntimeState {
  return {
    current: { valence: 0, arousal: 0, dominance: 0 },
    target: { valence, arousal: 0.72, dominance: 0.2 },
    dominantEmotion: "happy",
    intensity: 0.8
  };
}
