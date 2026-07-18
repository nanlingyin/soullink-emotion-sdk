import { scaleFACSFromNeutral } from "../facs/FACSUtils";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";

export class RecoveryController {
  private startedAt = 0;
  private duration = 0;
  private from: PartialFACSLikeState = {};

  start(from: PartialFACSLikeState, duration: number, timeSeconds: number) {
    this.from = { ...from };
    this.duration = Math.max(0.2, duration);
    this.startedAt = timeSeconds;
  }

  reset() {
    this.from = {};
    this.duration = 0;
    this.startedAt = 0;
  }

  get active(): boolean {
    return this.duration > 0;
  }

  isComplete(timeSeconds: number): boolean {
    return this.active && timeSeconds - this.startedAt >= this.duration;
  }

  update(timeSeconds: number): PartialFACSLikeState {
    if (!this.active) return {};

    const progress = Math.min(1, (timeSeconds - this.startedAt) / this.duration);
    const weight = Math.pow(1 - progress, 1.8);
    return scaleFACSFromNeutral(this.from, weight);
  }
}
