import { scaleFACS } from "../facs/FACSUtils";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";

export class IdleBiasController {
  private bias: PartialFACSLikeState = {};
  private startedAt = 0;
  private duration = 0;

  setBias(bias: PartialFACSLikeState, duration: number, timeSeconds: number) {
    this.bias = { ...bias };
    this.duration = Math.max(0.1, duration);
    this.startedAt = timeSeconds;
  }

  reset() {
    this.bias = {};
    this.duration = 0;
    this.startedAt = 0;
  }

  update(timeSeconds: number): PartialFACSLikeState {
    if (this.duration <= 0) return {};

    const progress = Math.min(1, (timeSeconds - this.startedAt) / this.duration);
    const residue = Math.pow(1 - progress, 0.82);

    if (progress >= 1) {
      this.reset();
      return {};
    }

    return scaleFACS(this.bias, residue);
  }
}
