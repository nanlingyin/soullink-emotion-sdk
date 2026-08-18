import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../../profile/ModelProfile";
import { SoullinkRuntime } from "../../runtime/SoullinkRuntime";
import {
  deriveSpeechPerformanceCapabilities,
  planSpeechPerformance,
  sampleSpeechPerformance,
  sampleSpeechPerformanceCurve,
  SPEECH_PERFORMANCE_CURVES,
  SPEECH_GESTURE_TEMPLATES,
  SPEECH_EXPRESSION_VARIANTS,
  SpeechPerformancePlanner,
  type SpeechExpressionChannel,
  type SpeechPerformanceGesture,
  type SpeechPerformancePlan,
  validateSpeechPerformanceRegistries
} from "../SpeechPerformancePlanner";

const profile = (keys: string[]): ModelProfile => ({
  modelId: "speech-performance-test",
  displayName: "Speech Performance Test",
  version: "1.0.0",
  modelPath: "/speech-performance.model3.json",
  parameterMap: Object.fromEntries(keys.map((key) => [key, { target: `Param${key}` }])) as ModelProfile["parameterMap"],
  idleConfig: {}
});

const fullProfile = profile([
  "headX", "headY", "headZ", "bodyX", "bodyY", "bodyZ", "gazeX", "gazeY",
  "browInnerUp", "browOuterUp", "browDown", "eyeSmile", "eyeSquint",
  "mouthSmile", "mouthFrown", "mouthPucker", "blush", "tear", "sweat"
]);

const runtimePlan = (options: {
  expression?: SpeechPerformancePlan["expression"]["facs"];
  gestures?: SpeechPerformanceGesture[];
  durationMs?: number;
  seed?: number;
  lifecycleToken?: number;
} = {}): SpeechPerformancePlan => ({
  version: 1,
  ...(options.lifecycleToken === undefined ? {} : { lifecycleToken: options.lifecycleToken }),
  seed: options.seed ?? 1,
  emotion: "calm",
  vad: { valence: 0.2, arousal: -0.2, dominance: 0.1 },
  intensity: 0.5,
  confidence: 0.8,
  semanticCues: [],
  deliveryHints: [],
  currentPosture: {},
  durationMs: options.durationMs ?? 1000,
  motionBudget: {
    maxSimultaneousAxes: 1,
    maxMotionDensity: 1,
    minRestWindowMs: 0,
    usedMotionDensity: options.gestures?.length ? 1 : 0,
    maxSimultaneousAxesUsed: options.gestures?.length ? 1 : 0
  },
  expression: {
    emotion: "calm",
    variantId: "calm-test",
    facs: options.expression ?? {},
    supportedChannels: Object.keys(options.expression ?? {}) as SpeechExpressionChannel[],
    gestureAffinity: []
  },
  gestures: options.gestures ?? []
});

describe("speech performance registries", () => {
  it("keeps curves, templates, and expression variants valid", () => {
    expect(validateSpeechPerformanceRegistries()).toEqual({ valid: true, errors: [] });
    expect(Object.keys(SPEECH_PERFORMANCE_CURVES)).toHaveLength(8);
    expect(Object.keys(SPEECH_GESTURE_TEMPLATES).length).toBeGreaterThanOrEqual(16);
    Object.values(SPEECH_EXPRESSION_VARIANTS).forEach((variants) => expect(variants.length).toBeGreaterThanOrEqual(3));
  });

  it("returns bounded curves that start and end at neutral", () => {
    for (const curveId of Object.keys(SPEECH_PERFORMANCE_CURVES) as Array<keyof typeof SPEECH_PERFORMANCE_CURVES>) {
      const curve = SPEECH_PERFORMANCE_CURVES[curveId];
      expect(sampleSpeechPerformanceCurve(curveId, 0)).toBe(curve.keyframes[0].value);
      expect(sampleSpeechPerformanceCurve(curveId, 1)).toBe(curve.keyframes[curve.keyframes.length - 1].value);
      for (let index = 0; index <= 20; index += 1) {
        const value = sampleSpeechPerformanceCurve(curveId, index / 20);
        expect(value).toBeGreaterThanOrEqual(curve.range[0]);
        expect(value).toBeLessThanOrEqual(curve.range[1]);
      }

      for (const keyframe of curve.keyframes.slice(1, -1)) {
        const before = sampleSpeechPerformanceCurve(curveId, keyframe.at - 0.000001);
        const after = sampleSpeechPerformanceCurve(curveId, keyframe.at + 0.000001);
        expect(Math.abs(after - before)).toBeLessThan(0.001);
      }

      let previous = sampleSpeechPerformanceCurve(curveId, 0);
      for (let index = 1; index <= 1000; index += 1) {
        const current = sampleSpeechPerformanceCurve(curveId, index / 1000);
        expect(Math.abs(current - previous) * 1000).toBeLessThanOrEqual(curve.maxNormalizedVelocity);
        previous = current;
      }
    }
  });
});

describe("planSpeechPerformance", () => {
  it("is deterministic and keeps output semantic", () => {
    const capabilities = deriveSpeechPerformanceCapabilities(fullProfile);
    const input = {
      emotion: "excited",
      durationMs: 4200,
      intensity: 0.8,
      confidence: 0.9,
      semanticCues: ["emphasis"],
      deliveryHints: ["celebrate"],
      seed: 42,
      capabilities
    };
    const first = planSpeechPerformance(input);
    const second = planSpeechPerformance(input);

    expect(first).toEqual(second);
    expect(first.gestures.length).toBeGreaterThan(1);
    expect(first.gestures.every((gesture) => Object.keys(gesture.channels).every((key) => capabilities.gestureChannels?.includes(key as never)))).toBe(true);
    expect(Object.keys(first.expression.facs)).not.toContain("mouthOpen");
    expect(Object.keys(first.expression.facs)).not.toContain("eyeOpen");
  });

  it("degrades to the channels available in a partial Profile", () => {
    const capabilities = deriveSpeechPerformanceCapabilities(profile(["headY", "mouthSmile"]));
    const plan = planSpeechPerformance({ emotion: "happy", durationMs: 4000, seed: 7, capabilities });
    const gestureKeys = plan.gestures.flatMap((gesture) => Object.keys(gesture.channels));

    expect(capabilities.gestureChannels).toEqual(["headY"]);
    expect(gestureKeys.every((key) => key === "headY")).toBe(true);
    expect(Object.keys(plan.expression.facs).every((key) => key === "mouthSmile")).toBe(true);
  });

  it("returns a safe empty gesture plan when a model has no compatible channels", () => {
    const plan = planSpeechPerformance({
      emotion: "happy",
      durationMs: 4000,
      capabilities: deriveSpeechPerformanceCapabilities(profile([]))
    });

    expect(plan.gestures).toEqual([]);
    expect(plan.expression.facs).toEqual({});
  });

  it("keeps short connector segments still", () => {
    const plan = planSpeechPerformance({ emotion: "calm", durationMs: 500, capabilities: deriveSpeechPerformanceCapabilities(fullProfile) });
    expect(plan.gestures).toEqual([]);
    expect(plan.durationMs).toBe(500);
  });

  it("applies low-tier and reduced-motion budgets to long segments", () => {
    const capabilities = deriveSpeechPerformanceCapabilities(fullProfile);
    const baseInput = { emotion: "excited", durationMs: 11000, intensity: 0.9, seed: 31 } as const;
    const standard = planSpeechPerformance({ ...baseInput, capabilities });
    const low = planSpeechPerformance({ ...baseInput, capabilities: { ...capabilities, performanceTier: "low" } });
    const reduced = planSpeechPerformance({ ...baseInput, capabilities: { ...capabilities, reducedMotion: true } });
    const peakAmplitude = (plan: SpeechPerformancePlan) => Math.max(
      0,
      ...plan.gestures.flatMap((gesture) => Object.values(gesture.channels).map((value) => Math.abs(value ?? 0)))
    );

    expect(standard.gestures.length).toBeGreaterThan(1);
    expect(low.motionBudget.maxSimultaneousAxes).toBeLessThanOrEqual(3);
    expect(low.motionBudget.usedMotionDensity).toBeLessThanOrEqual(0.62);
    expect(low.motionBudget.minRestWindowMs).toBeGreaterThanOrEqual(160);
    expect(reduced.motionBudget.maxSimultaneousAxes).toBeLessThanOrEqual(2);
    expect(reduced.motionBudget.usedMotionDensity).toBeLessThanOrEqual(0.38);
    expect(reduced.motionBudget.minRestWindowMs).toBeGreaterThanOrEqual(240);
    expect(peakAmplitude(low)).toBeLessThan(peakAmplitude(standard));
    expect(peakAmplitude(reduced)).toBeLessThan(peakAmplitude(low));
  });

  it("disables both gesture and expression output when performance is disabled", () => {
    const plan = planSpeechPerformance({
      emotion: "happy",
      durationMs: 4000,
      capabilities: { ...deriveSpeechPerformanceCapabilities(fullProfile), enabled: false }
    });

    expect(plan.gestures).toEqual([]);
    expect(plan.expression.facs).toEqual({});
  });

  it("uses recent history to vary adjacent segments", () => {
    const planner = new SpeechPerformancePlanner({ historyLimit: 8 });
    const first = planner.plan({ emotion: "curious", durationMs: 2800, seed: 10, capabilities: deriveSpeechPerformanceCapabilities(fullProfile) });
    const second = planner.plan({ emotion: "curious", durationMs: 2800, seed: 11, capabilities: deriveSpeechPerformanceCapabilities(fullProfile) });

    expect(first.gestures[0]).toBeDefined();
    expect(second.gestures[0]).toBeDefined();
    expect(second.gestures[0]?.templateId).not.toBe(first.gestures[0]?.templateId);
    expect(planner.getHistory().length).toBeGreaterThan(0);
  });

  it("balances lateral direction against recent segment history", () => {
    const plan = planSpeechPerformance({
      emotion: "curious",
      durationMs: 4200,
      seed: 14,
      history: [{ direction: 1 }],
      capabilities: {
        gestureChannels: ["headX", "headZ", "gazeX"],
        expressionChannels: []
      }
    });

    expect(plan.gestures[0]?.direction).toBe(-1);
    for (let index = 1; index < plan.gestures.length; index += 1) {
      expect(plan.gestures[index].direction).toBe(-plan.gestures[index - 1].direction);
    }
  });

  it("samples gesture and expression layers without taking mouth ownership", () => {
    const plan = planSpeechPerformance({ emotion: "happy", durationMs: 2400, seed: 12, capabilities: deriveSpeechPerformanceCapabilities(fullProfile) });
    const sample = sampleSpeechPerformance(plan, plan.gestures[0]?.peakMs ?? 900);

    expect(sample.activeBeatIds.length).toBeGreaterThan(0);
    expect(Object.keys(sample.speechGesture).some((key) => key.startsWith("head") || key.startsWith("body") || key.startsWith("gaze"))).toBe(true);
    expect(sample.speechGesture).not.toHaveProperty("mouthOpen");
    expect(sample.expressionAccent).not.toHaveProperty("mouthOpen");
  });
});

describe("runtime speech performance ownership", () => {
  it("composes a speech plan without replacing LipSync or manual state", () => {
    const runtime = new SoullinkRuntime({ profile: fullProfile });
    runtime.setIdleEnabled(false);
    runtime.setVoicePlaybackActive(true);
    runtime.setManualFACS({ mouthSmile: 0.2 });
    runtime.startSpeechPerformance(runtimePlan({
      expression: { mouthSmile: 0.1, mouthOpen: 1 },
      gestures: [{
        id: "test-beat",
        templateId: "softNod",
        family: "acknowledgement",
        cooldownGroup: "acknowledgement",
        curveId: "softPulse",
        startMs: 0,
        durationMs: 1000,
        peakMs: 500,
        restBeforeMs: 0,
        direction: 1,
        channels: { headY: 0.2 }
      }]
    }), 0);

    const snapshot = runtime.update(0.5, 1 / 60);
    expect(snapshot.facs.headY).toBeGreaterThan(0);
    expect(snapshot.facs.mouthSmile).toBe(0.2);
    expect(snapshot.facs.mouthOpen).toBeGreaterThan(0);
    expect(snapshot.facs.mouthOpen).toBeLessThan(1);
  });

  it("supports replace, append, and interrupt lifecycle modes", () => {
    const runtime = new SoullinkRuntime({ profile: fullProfile });
    runtime.setIdleEnabled(false);
    const firstPlan = runtimePlan({ expression: { tear: 0.8 }, seed: 21 });
    const secondPlan = runtimePlan({ expression: { blush: 0.7 }, seed: 22 });

    runtime.startSpeechPerformance(firstPlan, 0);
    expect(runtime.update(0.2, 1 / 60).facs.tear).toBe(0.8);
    runtime.startSpeechPerformance(secondPlan, 0.2, "replace");
    const replaced = runtime.update(0.2, 1 / 60);
    expect(replaced.facs.tear).toBe(0);
    expect(replaced.facs.blush).toBe(0.7);

    runtime.startSpeechPerformance(firstPlan, 1);
    runtime.startSpeechPerformance(secondPlan, 1, "append");
    const firstSegment = runtime.update(1.5, 1 / 60);
    const secondSegment = runtime.update(2.5, 1 / 60);
    expect(firstSegment.facs.tear).toBe(0.8);
    expect(firstSegment.facs.blush).toBe(0);
    expect(secondSegment.facs.tear).toBe(0);
    expect(secondSegment.facs.blush).toBe(0.7);

    runtime.startSpeechPerformance(firstPlan, 3);
    runtime.startSpeechPerformance(secondPlan, 3.1, "interrupt");
    const interrupted = runtime.update(3.1, 1 / 60);
    expect(interrupted.facs.tear).toBe(0);
    expect(interrupted.facs.blush).toBe(0.7);

    runtime.clearSpeechPerformance();
    const cleared = runtime.update(3.2, 1 / 60);
    expect(cleared.facs.tear).toBe(0);
    expect(cleared.facs.blush).toBe(0);

    const latestPlan = runtimePlan({ expression: { blush: 0.6 }, lifecycleToken: 12 });
    const stalePlan = runtimePlan({ expression: { tear: 0.9 }, lifecycleToken: 11 });
    expect(runtime.startSpeechPerformance(latestPlan, 4)).toBe(true);
    expect(runtime.startSpeechPerformance(stalePlan, 4.1, "replace")).toBe(false);
    const afterStaleResult = runtime.update(4.1, 1 / 60);
    expect(afterStaleResult.facs.blush).toBe(0.6);
    expect(afterStaleResult.facs.tear).toBe(0);
  });
});
