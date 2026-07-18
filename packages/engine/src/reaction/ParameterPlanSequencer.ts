import type { Live2DParamState } from "../facs/FACSLikeState";
import { ease } from "../utils/easing";
import { lerp } from "../utils/lerp";
import type { SoullinkParameterBeat } from "./SoullinkPlan";

export class ParameterPlanSequencer {
  private beats: SoullinkParameterBeat[] = [];
  private startedAt = 0;
  private lastActiveSignature = "";

  start(beats: SoullinkParameterBeat[] | undefined, timeSeconds: number) {
    this.beats = (beats ?? [])
      .filter((beat) => beat.duration > 0 && Object.keys(beat.parameters ?? {}).length > 0)
      .slice(0, 24)
      .sort((a, b) => a.time - b.time);
    this.startedAt = timeSeconds;
    this.lastActiveSignature = "";
    console.info("[SpeakingMotion] sequencer start", {
      beatCount: this.beats.length,
      startedAt: timeSeconds,
      beats: this.beats.map((beat, index) => ({
        index,
        time: beat.time,
        duration: beat.duration,
        label: beat.label,
        parameterIds: Object.keys(beat.parameters)
      }))
    });
  }

  reset() {
    if (this.beats.length > 0) {
      console.info("[SpeakingMotion] sequencer reset", {
        beatCount: this.beats.length
      });
    }
    this.beats = [];
    this.startedAt = 0;
    this.lastActiveSignature = "";
  }

  get beatCount(): number {
    return this.beats.length;
  }

  evaluate(timeSeconds: number): Live2DParamState {
    if (this.beats.length === 0) return {};

    const elapsed = Math.max(0, timeSeconds - this.startedAt);
    let previousParameters: Live2DParamState = {};

    for (const [index, beat] of this.beats.entries()) {
      if (elapsed < beat.time) {
        const activeLabels = Object.keys(previousParameters).length
          ? [`hold-before-${index}:${beat.label ?? "beat"}`]
          : [];
        this.logActiveBeatChange(elapsed, activeLabels, previousParameters);
        return previousParameters;
      }

      const transitionEnd = beat.time + beat.duration;
      if (elapsed <= transitionEnd) {
        const progress = beat.duration <= 0 ? 1 : (elapsed - beat.time) / beat.duration;
        const easedProgress = ease("easeInOut", progress);
        const result = interpolateParameters(previousParameters, beat.parameters, easedProgress);

        this.logActiveBeatChange(elapsed, [`transition-${index}:${beat.label ?? "beat"}`], result);
        return result;
      }

      previousParameters = beat.parameters;
    }

    const lastBeat = this.beats[this.beats.length - 1];
    this.logActiveBeatChange(elapsed, [`hold-last:${lastBeat?.label ?? "beat"}`], previousParameters);
    return previousParameters;
  }

  private logActiveBeatChange(elapsed: number, activeLabels: string[], parameters: Live2DParamState) {
    const activeSignature = activeLabels.join("|");
    if (activeSignature === this.lastActiveSignature) return;

    this.lastActiveSignature = activeSignature;
    if (!activeSignature) {
      console.info("[SpeakingMotion] overlay inactive", {
        elapsed
      });
      return;
    }

    console.info("[SpeakingMotion] overlay active", {
      elapsed,
      activeLabels,
      parameters
    });
  }
}

function interpolateParameters(
  from: Live2DParamState,
  to: Live2DParamState,
  progress: number
): Live2DParamState {
  const result: Live2DParamState = {};
  const parameterIds = new Set([...Object.keys(from), ...Object.keys(to)]);

  for (const id of parameterIds) {
    const fromValue = from[id] ?? 0;
    const toValue = to[id] ?? 0;
    result[id] = lerp(fromValue, toValue, progress);
  }

  return result;
}
