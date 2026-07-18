import { addFACS, clampFACSState, scaleFACSFromNeutral } from "../facs/FACSUtils";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";
import { ActionUnitSolver } from "../expression/ActionUnitSolver";
import { clamp01 } from "../utils/clamp";
import type { SoullinkActionBeat } from "./SoullinkPlan";

function envelope(progress: number): number {
  const t = clamp01(progress);
  return Math.sin(Math.PI * t);
}

export class ActionPlanSequencer {
  private beats: SoullinkActionBeat[] = [];
  private startedAt = 0;
  private actionUnitSolver = new ActionUnitSolver();

  start(beats: SoullinkActionBeat[] | undefined, timeSeconds: number) {
    this.beats = (beats ?? [])
      .filter((beat) => beat.duration > 0 && beat.intensity > 0)
      .slice(0, 12)
      .sort((a, b) => a.time - b.time);
    this.startedAt = timeSeconds;
  }

  reset() {
    this.beats = [];
    this.startedAt = 0;
  }

  get beatCount(): number {
    return this.beats.length;
  }

  get duration(): number {
    return this.beats.reduce((max, beat) => Math.max(max, beat.time + beat.duration), 0);
  }

  isComplete(timeSeconds: number): boolean {
    return this.beats.length === 0 || Math.max(0, timeSeconds - this.startedAt) >= this.duration;
  }

  evaluate(timeSeconds: number): PartialFACSLikeState {
    if (this.beats.length === 0) return {};

    const elapsed = Math.max(0, timeSeconds - this.startedAt);
    let result: PartialFACSLikeState = {};

    for (const beat of this.beats) {
      const local = (elapsed - beat.time) / beat.duration;
      if (local < 0 || local > 1) continue;

      const weight = envelope(local) * clamp01(beat.intensity);
      let layer: PartialFACSLikeState = {};

      if (beat.facs) {
        layer = addFACS(layer, scaleFACSFromNeutral(beat.facs, weight));
      }

      if (beat.actionUnits && Object.keys(beat.actionUnits).length > 0) {
        layer = addFACS(layer, scaleFACSFromNeutral(this.actionUnitSolver.solvePartial(beat.actionUnits), weight));
      }

      result = addFACS(result, layer);
    }

    return clampFACSState(result);
  }
}
