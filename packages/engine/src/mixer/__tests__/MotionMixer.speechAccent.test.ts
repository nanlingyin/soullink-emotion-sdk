import { describe, expect, it } from "vitest";
import { MotionMixer } from "../MotionMixer";

describe("MotionMixer speech accents", () => {
  it("adds a small speech brow accent without replacing the emotion shape", () => {
    const result = new MotionMixer().mix({
      emotion: { browOuterUp: 0.24 },
      speech: { browOuterUp: 0.06, headY: -0.02 }
    });

    expect(result.browOuterUp).toBeCloseTo(0.3, 8);
    expect(result.headY).toBeCloseTo(-0.02, 8);
  });

  it("keeps speech performance additive and outside mouth/eye ownership", () => {
    const result = new MotionMixer().mix({
      emotion: { browOuterUp: 0.24 },
      speechPerformance: {
        browOuterUp: 0.06,
        headY: 0.12,
        mouthOpen: 1,
        eyeOpen: 0,
        eyeBlinkL: 1,
        eyeBlinkR: 1
      }
    });

    expect(result.browOuterUp).toBeCloseTo(0.3, 8);
    expect(result.headY).toBeCloseTo(0.12, 8);
    expect(result.mouthOpen).toBe(0);
    expect(result.eyeOpen).toBe(1);
    expect(result.eyeBlinkL).toBe(0);
    expect(result.eyeBlinkR).toBe(0);
  });
});
