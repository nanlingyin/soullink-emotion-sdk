import { describe, expect, it } from "vitest";
import {
  deriveNeutralParams,
  deriveParameterRanges,
  deriveParameterSmoothing,
} from "../deriveProfileDefaults";
import type { ModelProfile } from "../ModelProfile";

const tinyProfile = {
  parameterMap: {
    eyeOpen: { target: "ParamEyeLOpen", min: 0, max: 1 },
    breath: { targets: ["ParamBreath", "ParamBodyAngleY"], min: -0.5, max: 0.5 },
    mouthSmile: { target: "ParamMouthSmile", min: -1, max: 1 },
  },
  customParams: {
    sparkle: { target: "ParamSparkle", min: 0, max: 2 },
  },
} satisfies Pick<ModelProfile, "parameterMap" | "customParams">;

describe("deriveProfileDefaults", () => {
  it("derives neutral parameter values from a tiny map", () => {
    expect(deriveNeutralParams(tinyProfile)).toEqual({
      ParamEyeLOpen: 1,
      ParamBreath: 0.5,
      ParamBodyAngleY: 0.5,
      ParamMouthSmile: 0,
      ParamSparkle: 0,
    });
  });

  it("derives smoothing values from FACS families and custom params", () => {
    expect(deriveParameterSmoothing(tinyProfile)).toEqual({
      ParamEyeLOpen: 26,
      ParamBreath: 5,
      ParamBodyAngleY: 5,
      ParamMouthSmile: 12,
      ParamSparkle: 12,
    });
  });

  it("derives parameter min/max ranges", () => {
    expect(deriveParameterRanges(tinyProfile)).toEqual({
      ParamEyeLOpen: { min: 0, max: 1 },
      ParamBreath: { min: -0.5, max: 0.5 },
      ParamBodyAngleY: { min: -0.5, max: 0.5 },
      ParamMouthSmile: { min: -1, max: 1 },
      ParamSparkle: { min: 0, max: 2 },
    });
  });
});
