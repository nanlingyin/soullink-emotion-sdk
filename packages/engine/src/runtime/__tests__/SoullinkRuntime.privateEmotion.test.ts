import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../../profile/ModelProfile";
import { SoullinkRuntime } from "../SoullinkRuntime";

describe("SoullinkRuntime privateEmotionMap", () => {
  it("drives a numeric CDI parameter from the semantic intent end to end", () => {
    const profile: ModelProfile = {
      modelId: "private-emotion-runtime",
      displayName: "Private Emotion Runtime",
      version: "1.0.0",
      modelPath: "/models/private/avatar.model3.json",
      parameterMap: {},
      privateEmotionMap: {
        confusionEffect: {
          targets: ["Param6"],
          emotions: ["confused"],
          activeValue: 1,
          neutralValue: 0,
          intensity: 0.8,
          source: "heuristic"
        }
      },
      idleConfig: {}
    };
    const runtime = new SoullinkRuntime({ profile });
    runtime.setPrivateVADParameters({
      Param6: { name: "困惑", min: 0, max: 1, default: 0 }
    });

    runtime.triggerIntent({
      emotion: "confused",
      variant: "confused",
      intensity: 0.8,
      contextTags: [],
      sourceMessage: "为什么"
    }, 0, { seed: 1 });

    const snapshot = runtime.update(1 / 60, 1 / 60);
    expect(snapshot.vad.dominantEmotion).not.toBe("confused");
    expect(snapshot.live2dParams.Param6).toBeGreaterThan(0);
  });
});
