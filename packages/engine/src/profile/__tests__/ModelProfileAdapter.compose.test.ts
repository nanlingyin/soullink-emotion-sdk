import { describe, expect, it } from "vitest";
import { ModelProfileAdapter } from "../ModelProfileAdapter";
import type { ModelProfile } from "../ModelProfile";

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    modelId: "test-model",
    displayName: "Test Model",
    version: "1.0.0",
    modelPath: "models/test.model3.json",
    parameterMap: {},
    idleConfig: {},
    capabilities: {
      headControl: true,
      bodyControl: true,
      eyeBlink: true,
      eyeSmile: true,
      gazeControl: true,
      mouthOpen: true,
      mouthSmile: true,
      browControl: true,
      blush: true,
      tear: true,
      sweat: true,
      breath: true,
    },
    ...overrides,
  };
}

describe("ModelProfileAdapter compose semantics", () => {
  it("keeps v1 object-order behavior for eyeOpen then eyeBlink", () => {
    const adapter = new ModelProfileAdapter(profile({
      parameterMap: {
        eyeOpen: { target: "ParamEyeLOpen", mode: "set", scale: 1, min: 0, max: 1 },
        eyeBlinkL: { target: "ParamEyeLOpen", mode: "add", scale: -1, min: 0, max: 1 },
      },
    }));

    expect(adapter.apply({ eyeOpen: 0.8, eyeBlinkL: 0.25 })).toEqual({
      ParamEyeLOpen: 0.55,
    });
  });

  it("makes v2 add/subtract deltas order-independent", () => {
    const first = new ModelProfileAdapter(profile({
      schemaVersion: 2,
      neutralParams: { ParamMouthSmile: 0.5 },
      parameterMap: {
        mouthSmile: { target: "ParamMouthSmile", mode: "add", scale: 0.25, min: -1, max: 1 },
        mouthFrown: { target: "ParamMouthSmile", mode: "subtract", scale: 0.1, min: -1, max: 1 },
      },
    }));

    const second = new ModelProfileAdapter(profile({
      schemaVersion: 2,
      neutralParams: { ParamMouthSmile: 0.5 },
      parameterMap: {
        mouthFrown: { target: "ParamMouthSmile", mode: "subtract", scale: 0.1, min: -1, max: 1 },
        mouthSmile: { target: "ParamMouthSmile", mode: "add", scale: 0.25, min: -1, max: 1 },
      },
    }));

    const facs = { mouthSmile: 0.8, mouthFrown: 0.5 };
    const resultA = first.apply(facs);
    const resultB = second.apply(facs);
    expect(resultA.ParamMouthSmile).toBeCloseTo(resultB.ParamMouthSmile, 10);
    expect(resultA.ParamMouthSmile).toBeCloseTo(0.65, 10);
  });

  it("maps custom channels only for schemaVersion 2", () => {
    const v1 = new ModelProfileAdapter(profile({
      customParams: {
        excitement: { target: "ParamExcitement", mode: "set", scale: 2 },
      },
    }));
    const v2 = new ModelProfileAdapter(profile({
      schemaVersion: 2,
      customParams: {
        excitement: { target: "ParamExcitement", mode: "set", scale: 2 },
      },
    }));

    // v1 legacy: neutral for customParams target is 0; custom channels are ignored
    expect(v1.apply({}, { excitement: 0.4 })).toEqual({ ParamExcitement: 0 });
    // v2: custom channel maps through scale=2 → 0.4*2=0.8
    expect(v2.apply({}, { excitement: 0.4 })).toEqual({ ParamExcitement: 0.8 });
  });
});
