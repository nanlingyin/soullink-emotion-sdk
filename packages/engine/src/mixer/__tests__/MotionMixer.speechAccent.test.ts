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
});
