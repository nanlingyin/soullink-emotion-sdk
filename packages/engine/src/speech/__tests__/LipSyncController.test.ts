import { describe, expect, it } from "vitest";
import { LipSyncController } from "../LipSyncController";
import { NullAudioLevelAnalyzer } from "../AudioLevelAnalyzer";

describe("LipSyncController", () => {
  it("keeps the procedural fallback unchanged without a measured level", () => {
    const controller = new LipSyncController();
    const result = controller.update(0.37, {
      enabled: true,
      speaking: true,
      intensity: 0.6
    });
    const syllable = Math.sin(0.37 * 18.5) * 0.5 + Math.sin(0.37 * 31.2) * 0.25 + 0.5;

    expect(result.mouthOpen).toBeCloseTo(Math.max(0, syllable) * (0.18 + 0.6 * 0.34), 12);
    expect(result.headX).toBeCloseTo(Math.sin(0.37 * 2.6) * 0.018, 12);
    expect(result.headY).toBeCloseTo(Math.sin(0.37 * 2.1 + 0.8) * 0.012, 12);
    expect(result.headZ).toBeUndefined();
  });

  it("uses attack and release smoothing for measured levels", () => {
    const controller = new LipSyncController();
    const base = { enabled: true, speaking: true, intensity: 1, deltaSeconds: 1 / 60 };
    const quiet = controller.update(0, { ...base, audioLevel: 0 });
    const attack = controller.update(1 / 60, { ...base, audioLevel: 1 });
    const release = controller.update(2 / 60, { ...base, audioLevel: 0 });

    expect(quiet.mouthOpen).toBe(0);
    expect(attack.mouthOpen).toBeGreaterThan(0);
    expect(attack.mouthOpen).toBeLessThan(0.52);
    expect(release.mouthOpen).toBeGreaterThan(0);
    expect(release.mouthOpen).toBeLessThan(attack.mouthOpen ?? 0);
  });

  it("gates low-level noise and emits a small, cooled-down accent", () => {
    const controller = new LipSyncController();
    const common = { enabled: true, speaking: true, intensity: 1, deltaSeconds: 0.05 };
    const noise = controller.update(0, { ...common, audioLevel: 0.02, audioPeak: 0.04 });
    const first = controller.update(0.05, { ...common, audioLevel: 0.32, audioPeak: 0.5 });
    const held = controller.update(0.1, { ...common, audioLevel: 0.34, audioPeak: 0.52 });
    const second = controller.update(0.3, { ...common, audioLevel: 0.34, audioPeak: 0.9 });

    expect(noise.mouthOpen).toBe(0);
    expect(first.browOuterUp).toBeGreaterThan(0);
    expect(first.headY).toBeLessThan(0);
    expect(Math.abs(first.headZ ?? 0)).toBeGreaterThan(0);
    expect(held.browOuterUp).toBeLessThan(first.browOuterUp ?? 0);
    expect(second.browOuterUp).toBeGreaterThan(held.browOuterUp ?? 0);
  });

  it("resets measured state when speaking stops or reset is called", () => {
    const controller = new LipSyncController();
    const measured = controller.update(0, {
      enabled: true,
      speaking: true,
      intensity: 1,
      audioLevel: 1,
      audioPeak: 1
    });
    expect(measured.mouthOpen).toBeGreaterThan(0);

    expect(controller.update(0.1, {
      enabled: true,
      speaking: false,
      intensity: 1,
      audioLevel: 1,
      audioPeak: 1
    })).toEqual({});

    const afterStop = controller.update(0.2, {
      enabled: true,
      speaking: true,
      intensity: 1,
      audioLevel: 0,
      audioPeak: 0
    });
    expect(afterStop.mouthOpen).toBe(0);
    expect(afterStop.browOuterUp).toBe(0);

    controller.update(0.3, {
      enabled: true,
      speaking: true,
      intensity: 1,
      audioLevel: 1,
      audioPeak: 1
    });
    controller.reset();
    const afterReset = controller.update(0.4, {
      enabled: true,
      speaking: true,
      intensity: 1,
      audioLevel: 0,
      audioPeak: 0
    });
    expect(afterReset.mouthOpen).toBe(0);
    expect(afterReset.browOuterUp).toBe(0);
  });

  it("exposes an unavailable null analyzer without changing the old contract", () => {
    const analyzer = new NullAudioLevelAnalyzer();
    expect(analyzer.getLevel()).toBe(0);
    expect(analyzer.getPeak?.()).toBe(0);
    expect(analyzer.isAvailable?.()).toBe(false);
    expect(analyzer.available?.()).toBe(false);
    expect(() => analyzer.reset?.()).not.toThrow();
  });
});
