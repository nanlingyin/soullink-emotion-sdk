import { clamp } from "../utils/clamp";
import { seededRandom } from "../utils/seededRandom";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";

export class MicroMotionController {
  private phases: number[];
  private rates: number[];

  constructor(seed = 23) {
    const random = seededRandom(seed);
    this.phases = Array.from({ length: 8 }, () => random() * Math.PI * 2);
    this.rates = Array.from({ length: 8 }, () => 0.86 + random() * 0.28);
  }

  update(timeSeconds: number, focusLevel: number, gain = 1): PartialFACSLikeState {
    const damp = (1 - Math.min(1, focusLevel) * 0.65) * clamp(gain, 0, 2);
    const wave = (index: number, frequency: number, secondaryFrequency: number) => (
      Math.sin(timeSeconds * frequency * this.rates[index] + this.phases[index]) * 0.72
      + Math.sin(timeSeconds * secondaryFrequency * this.rates[index + 4] + this.phases[index + 4]) * 0.28
    );

    return {
      headX: wave(0, 0.38, 0.17) * 0.02 * damp,
      headY: wave(1, 0.31, 0.13) * 0.016 * damp,
      headZ: wave(2, 0.24, 0.11) * 0.014 * damp,
      mouthSmile: 0.045 + wave(3, 0.24, 0.09) * 0.018 * damp,
      browInnerUp: Math.max(0, wave(0, 0.18, 0.07) * 0.025 * damp)
    };
  }
}
