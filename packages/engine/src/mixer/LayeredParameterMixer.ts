import { smoothingFactor, smoothDamp } from "../utils/smoothing";
import type { Live2DParamState } from "../facs/FACSLikeState";

export class LayeredParameterMixer {
  private current: Live2DParamState = {};

  reset() {
    this.current = {};
  }

  smooth(target: Live2DParamState, deltaSeconds: number, speedByParam: Record<string, number> = {}): Live2DParamState {
    const result: Live2DParamState = { ...this.current };
    const keys = new Set([...Object.keys(this.current), ...Object.keys(target)]);

    for (const key of keys) {
      const current = this.current[key] ?? target[key] ?? 0;
      const next = target[key] ?? 0;
      const speed = speedByParam[key] ?? 14;
      const factor = smoothingFactor(speed, deltaSeconds);
      result[key] = smoothDamp(current, next, factor);
    }

    this.current = result;
    return result;
  }
}
