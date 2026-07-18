import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../../profile/ModelProfile";
import { deriveMotionSeed, resolveMotionStyle } from "../MotionStyle";
import { SoullinkRuntime } from "../SoullinkRuntime";

const profile: ModelProfile = {
  modelId: "motion-style-test",
  displayName: "Motion Style Test",
  version: "1.0.0",
  modelPath: "/motion-style.model3.json",
  parameterMap: {},
  idleConfig: {}
};

describe("MotionStyle", () => {
  it("normalizes unsafe values at the public boundary", () => {
    const style = resolveMotionStyle({
      seed: 0,
      spontaneity: 99,
      gestureFrequency: -2,
      gazeStability: 3,
      blinkRate: 0,
      breathRate: 4,
      breathVariance: -1,
      microMotionGain: 8,
      idleActionGain: -1,
      avoidRepeatWindow: 2.6,
      speechAccentGain: 9
    });

    expect(style).toMatchObject({
      seed: 1,
      spontaneity: 2,
      gestureFrequency: 0,
      gazeStability: 1,
      blinkRate: 0.25,
      breathRate: 1.8,
      breathVariance: 0,
      microMotionGain: 2,
      idleActionGain: 0,
      avoidRepeatWindow: 3,
      speechAccentGain: 2
    });
  });

  it("derives stable independent controller seeds", () => {
    expect(deriveMotionSeed(42, 3)).toBe(deriveMotionSeed(42, 3));
    expect(deriveMotionSeed(42, 3)).not.toBe(deriveMotionSeed(42, 4));
  });

  it("reproduces implicit intent seeds for the same session seed", () => {
    const first = new SoullinkRuntime({ profile, motionStyle: { seed: 7788 } });
    const second = new SoullinkRuntime({ profile, motionStyle: { seed: 7788 } });
    const intent = {
      emotion: "happy",
      intensity: 0.7,
      contextTags: []
    };

    first.triggerIntent(intent, 0);
    second.triggerIntent(intent, 0);

    expect(first.getSnapshot().seed).toBe(second.getSnapshot().seed);
    expect(first.getMotionStyle().seed).toBe(7788);
  });

  it("uses measured audio when available and procedural fallback on analyzer failure", () => {
    let fail = false;
    const runtime = new SoullinkRuntime({
      profile,
      motionStyle: { seed: 3 },
      audioLevelAnalyzer: {
        getLevel() {
          if (fail) throw new Error("audio source unavailable");
          return 0.8;
        },
        getPeak: () => 0.92,
        isAvailable: () => true
      }
    });
    runtime.setVoicePlaybackActive(true);

    const measured = runtime.update(0, 1 / 60).facs.mouthOpen;
    fail = true;
    const fallback = runtime.update(0.12, 1 / 60).facs.mouthOpen;

    expect(measured).toBeGreaterThan(0);
    expect(fallback).toBeGreaterThan(0);
    expect(fallback).not.toBe(measured);
  });
});
