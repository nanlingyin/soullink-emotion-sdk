import { clamp } from "../utils/clamp";
import { seededRandom } from "../utils/seededRandom";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";

export interface BreathingOptions {
  rate?: number;
  variance?: number;
}

export class BreathingController {
  private phase: number;
  private modulationPhase: number;
  private secondaryPhase: number;

  constructor(seed = 17) {
    const random = seededRandom(seed);
    this.phase = random() * Math.PI * 2;
    this.modulationPhase = random() * Math.PI * 2;
    this.secondaryPhase = random() * Math.PI * 2;
  }

  update(timeSeconds: number, options: BreathingOptions = {}): PartialFACSLikeState {
    const rate = clamp(options.rate ?? 1, 0.5, 1.8);
    const variance = clamp(options.variance ?? 0.42, 0, 1);
    const modulation = Math.sin(timeSeconds * 0.19 * rate + this.modulationPhase) * variance;
    const cycle = timeSeconds * 1.65 * rate + this.phase + modulation * 0.72;
    const secondary = Math.sin(timeSeconds * 0.73 * rate + this.secondaryPhase) * variance;
    const breath = clamp(0.5 + Math.sin(cycle) * 0.31 + secondary * 0.045, 0.08, 0.92);
    const bodyY = Math.sin(cycle - 0.3) * 0.022 + secondary * 0.004;

    return {
      breath,
      bodyY
    };
  }
}
