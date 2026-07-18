import { describe, expect, it } from "vitest";
import { VADPrivateParameterOverlay } from "../VADPrivateParameterOverlay";

const parameters = {
  Param6: { name: "困惑", min: 0, max: 1, default: 0 },
  Param7: { name: "星星", min: 0, max: 1, default: 0 },
  ParamMouthOpenY: { name: "嘴巴开合", min: 0, max: 1, default: 0 },
  ParamJawOpen: { name: "Jaw", min: 0, max: 1, default: 0 },
  ParamAlias: { name: "嘴巴开合", min: 0, max: 1, default: 0 },
  ParamMouthForm: { name: "嘴型", groupName: "张开和闭合", min: -1, max: 1, default: 0 },
  ParamLipShape: { name: "口型", groupName: "LipSync", min: 0, max: 1, default: 0 }
};

describe("VADPrivateParameterOverlay privateEmotionMap", () => {
  it("drives an arbitrary numeric parameter from dominant emotion", () => {
    const overlay = new VADPrivateParameterOverlay();
    overlay.setParameters(parameters, {
      confusion: {
        target: "Param6",
        emotions: ["confused"],
        activeValue: 1,
        neutralValue: 0,
        intensity: 0.8,
        source: "manual"
      }
    });

    const active = overlay.update(state("confused", -0.2, 0.5, -0.3));
    const inactive = overlay.update(state("happy", 0.7, 0.4, 0.2));

    expect(active.Param6).toBeCloseTo(0.8, 8);
    expect(inactive.Param6).toBe(0);
    expect(overlay.getSummary()).toMatchObject({ candidateCount: 2 });
  });

  it("supports VAD windows and resolves exclusive groups by priority", () => {
    const overlay = new VADPrivateParameterOverlay();
    overlay.setParameters(parameters, {
      confused: {
        target: "Param6",
        vadRange: { valence: [-1, 0], arousal: [0.2, 1] },
        intensity: 0.7,
        priority: 20,
        exclusiveGroup: "face-effect"
      },
      stars: {
        target: "Param7",
        vadRange: { valence: [-1, 0], arousal: [0.2, 1] },
        intensity: 0.9,
        priority: 80,
        exclusiveGroup: "face-effect"
      }
    });

    const result = overlay.update(state("neutral", -0.4, 0.8, 0));

    expect(result.Param6).toBe(0);
    expect(result.Param7).toBeCloseTo(0.9, 8);
  });

  it("ignores unknown and mouth-opening targets", () => {
    const overlay = new VADPrivateParameterOverlay();
    overlay.setParameters(parameters, {
      unknown: { target: "Ghost", emotions: ["confused"] },
      mouth: { target: "ParamMouthOpenY", emotions: ["confused"] },
      jaw: { target: "ParamJawOpen", emotions: ["confused"] },
      alias: { target: "ParamAlias", emotions: ["confused"] }
    });

    const result = overlay.update(state("confused", -0.3, 0.6, -0.2));

    expect(result.Ghost).toBeUndefined();
    expect(result.ParamMouthOpenY).toBeUndefined();
    expect(result.ParamJawOpen).toBeUndefined();
    expect(result.ParamAlias).toBeUndefined();
  });

  it("keeps mouth-form and lip-shape targets", () => {
    const overlay = new VADPrivateParameterOverlay();
    overlay.setParameters(parameters, {
      form: { target: "ParamMouthForm", emotions: ["happy"] },
      shape: { target: "ParamLipShape", emotions: ["happy"] }
    });

    const result = overlay.update(state("happy", 0.7, 0.4, 0.2));

    expect(result.ParamMouthForm).toBeDefined();
    expect(result.ParamLipShape).toBeDefined();
  });

  it("uses the semantic intent when VAD resolves to a neighboring emotion", () => {
    const overlay = new VADPrivateParameterOverlay();
    overlay.setParameters(parameters, {
      confusion: { target: "Param6", emotions: ["confused"], intensity: 0.8 }
    });

    const result = overlay.update(
      state("concerned", -0.2, 0.5, -0.3),
      1,
      { intentEmotion: "confused" }
    );

    expect(result.Param6).toBeCloseTo(0.8, 8);
  });

  it("does not heuristically rewrite parameters already owned by the profile map", () => {
    const overlay = new VADPrivateParameterOverlay();
    const blush = { Param10: { name: "脸红", min: 0, max: 1, default: 0 } };
    overlay.setParameters(blush, {}, new Set(["Param10"]));

    const result = overlay.update(state("shy", 0.8, 0.4, -0.4));

    expect(result.Param10).toBeUndefined();
    expect(overlay.getSummary().candidateCount).toBe(0);
  });
});

function state(emotion: string, valence: number, arousal: number, dominance: number) {
  return {
    current: { valence, arousal, dominance },
    target: { valence, arousal, dominance },
    dominantEmotion: emotion,
    intensity: 0.75
  };
}
