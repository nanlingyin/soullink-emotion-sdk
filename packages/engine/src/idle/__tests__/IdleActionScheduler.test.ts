import { describe, expect, it } from "vitest";
import { facsRangeForKey } from "../../facs/FACSUtils";
import type { FACSKey, PartialFACSLikeState } from "../../facs/FACSLikeState";
import type { VADVector } from "../../emotion/VADState";
import type { CharacterPersonality } from "../../expression/RuntimeExpressionGenerator";
import type { ModelCapabilities, ModelProfile } from "../../profile/ModelProfile";
import {
  IdleActionScheduler,
  type IdleActionDirection,
  type IdleActionLabel
} from "../IdleActionScheduler";

const neutralVAD: VADVector = { valence: 0, arousal: 0, dominance: 0 };
const personality: CharacterPersonality = {
  expressiveness: 0.85,
  softness: 0.65,
  shyness: 0.5,
  gazeStability: 0.68
};

const allCapabilities: ModelCapabilities = {
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
  breath: true
};

function createProfile(capabilities: ModelCapabilities = allCapabilities): ModelProfile {
  return {
    modelId: "idle-test",
    displayName: "Idle Test",
    version: "1",
    modelPath: "/idle-test.model3.json",
    capabilities,
    parameterMap: {},
    idleConfig: {}
  };
}

function update(
  scheduler: IdleActionScheduler,
  timeSeconds: number,
  profile = createProfile(),
  overrides: Partial<{ enabled: boolean; focusLevel: number; suppressed: boolean }> = {}
): PartialFACSLikeState {
  return scheduler.update(timeSeconds, {
    enabled: overrides.enabled ?? true,
    focusLevel: overrides.focusLevel ?? 0.2,
    vad: neutralVAD,
    personality,
    profile,
    suppressed: overrides.suppressed
  });
}

function collectStarts(
  scheduler: IdleActionScheduler,
  durationSeconds: number,
  stepSeconds = 0.05
): Array<{ label: IdleActionLabel; direction: IdleActionDirection; startedAt: number }> {
  const starts: Array<{ label: IdleActionLabel; direction: IdleActionDirection; startedAt: number }> = [];
  let previousStartedAt: number | null = null;

  for (let time = 0; time <= durationSeconds; time += stepSeconds) {
    update(scheduler, Number(time.toFixed(6)));
    const state = scheduler.getState();
    if (state.activeAction && state.startedAt !== null && state.startedAt !== previousStartedAt) {
      starts.push({
        label: state.activeAction,
        direction: state.direction,
        startedAt: state.startedAt
      });
      previousStartedAt = state.startedAt;
    }
  }

  return starts;
}

describe("IdleActionScheduler", () => {
  it("is reproducible for the same seed and varies for a different seed", () => {
    const options = {
      seed: 9182,
      minIntervalSeconds: 0.35,
      maxIntervalSeconds: 0.75,
      recentWindowSize: 3
    };
    const first = new IdleActionScheduler(options);
    const second = new IdleActionScheduler(options);
    const different = new IdleActionScheduler({ ...options, seed: 9183 });

    const firstStarts = collectStarts(first, 30);
    const secondStarts = collectStarts(second, 30);
    const differentStarts = collectStarts(different, 30);

    expect(firstStarts.length).toBeGreaterThan(8);
    expect(firstStarts).toEqual(secondStarts);
    expect(differentStarts).not.toEqual(firstStarts);
  });

  it("avoids recently used actions and immediate direction repeats", () => {
    const scheduler = new IdleActionScheduler({
      seed: 44,
      minIntervalSeconds: 0.25,
      maxIntervalSeconds: 0.45,
      recentWindowSize: 3
    });
    const starts = collectStarts(scheduler, 45);

    expect(starts.length).toBeGreaterThan(12);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index].label).not.toBe(starts[index - 1].label);
    }

    const directions = starts.map((entry) => entry.direction).filter((direction) => direction !== 0);
    expect(directions.length).toBeGreaterThan(5);
    for (let index = 1; index < directions.length; index += 1) {
      expect(directions[index]).not.toBe(directions[index - 1]);
    }
  });

  it("uses non-periodic low-frequency intervals and can be interrupted", () => {
    const scheduler = new IdleActionScheduler({
      seed: 77,
      minIntervalSeconds: 1.1,
      maxIntervalSeconds: 2.2
    });

    update(scheduler, 0);
    const firstDue = scheduler.getState().nextActionAt;
    expect(firstDue).not.toBeNull();
    expect(firstDue as number).toBeGreaterThanOrEqual(1.1);
    expect(firstDue as number).toBeLessThanOrEqual(2.2);

    update(scheduler, firstDue as number);
    const active = scheduler.getState();
    expect(active.activeAction).not.toBeNull();
    expect(active.nextActionAt as number).toBeGreaterThanOrEqual(
      (active.startedAt as number) + active.duration + 1.1
    );
    expect(active.nextActionAt as number).toBeLessThanOrEqual(
      (active.startedAt as number) + active.duration + 2.2
    );

    scheduler.interrupt((active.startedAt as number) + active.duration * 0.25);
    expect(scheduler.getState().activeAction).toBeNull();

    const afterInterrupt = scheduler.getState().nextActionAt as number;
    expect(afterInterrupt).toBeGreaterThan(active.startedAt as number);
    expect(update(scheduler, afterInterrupt - 0.01)).toEqual({});

    const starts = collectStarts(new IdleActionScheduler({
      seed: 112,
      minIntervalSeconds: 0.8,
      maxIntervalSeconds: 1.8
    }), 35, 0.05);
    const gaps = starts.slice(1).map((entry, index) => entry.startedAt - starts[index].startedAt);
    const roundedGaps = new Set(gaps.map((gap) => gap.toFixed(2)));
    expect(roundedGaps.size).toBeGreaterThan(3);
  });

  it("cancels while suppressed and waits before resuming", () => {
    const scheduler = new IdleActionScheduler({
      seed: 101,
      minIntervalSeconds: 0.4,
      maxIntervalSeconds: 0.6
    });
    update(scheduler, 0);
    const due = scheduler.getState().nextActionAt as number;
    update(scheduler, due);
    expect(scheduler.getState().activeAction).not.toBeNull();

    expect(update(scheduler, due + 0.05, createProfile(), { suppressed: true })).toEqual({});
    expect(scheduler.getState()).toMatchObject({
      activeAction: null,
      nextActionAt: null,
      suppressed: true
    });

    expect(update(scheduler, due + 4)).toEqual({});
    const resumed = scheduler.getState();
    expect(resumed.activeAction).toBeNull();
    expect(resumed.nextActionAt as number).toBeGreaterThan(due + 4);
  });

  it("fully disables discrete actions at zero spontaneity or gain", () => {
    for (const scheduler of [
      new IdleActionScheduler({ seed: 8, spontaneity: 0 }),
      new IdleActionScheduler({ seed: 8, gain: 0 })
    ]) {
      for (let time = 0; time <= 30; time += 1) {
        expect(update(scheduler, time)).toEqual({});
      }
      expect(scheduler.getState().activeAction).toBeNull();
      expect(scheduler.getState().nextActionAt).toBeNull();
    }
  });

  it("selects only slow blinks for a blink-only profile", () => {
    const blinkCapabilities: ModelCapabilities = {
      ...allCapabilities,
      headControl: false,
      bodyControl: false,
      eyeSmile: false,
      gazeControl: false,
      mouthOpen: false,
      mouthSmile: false,
      browControl: false,
      blush: false,
      tear: false,
      sweat: false,
      breath: false
    };
    const profile = createProfile(blinkCapabilities);
    const scheduler = new IdleActionScheduler({
      seed: 5,
      minIntervalSeconds: 0.25,
      maxIntervalSeconds: 0.3
    });

    update(scheduler, 0, profile);
    const due = scheduler.getState().nextActionAt as number;
    update(scheduler, due, profile);
    const active = scheduler.getState();
    expect(active.activeAction).toBe("slow-blink");

    const pose = update(scheduler, due + active.duration * 0.45, profile);
    expect(Object.keys(pose).sort()).toEqual(["eyeBlinkL", "eyeBlinkR"]);
    expect(pose.eyeBlinkL).toBeGreaterThan(0.5);
    expect(pose.eyeBlinkR).toBeGreaterThan(0.5);
    expect(pose.eyeBlinkL).not.toBe(pose.eyeBlinkR);
  });

  it("keeps every emitted channel inside its FACS range", () => {
    const scheduler = new IdleActionScheduler({
      seed: 303,
      gain: 2.5,
      spontaneity: 1,
      minIntervalSeconds: 0.25,
      maxIntervalSeconds: 0.4
    });

    for (let time = 0; time <= 50; time += 0.025) {
      const pose = update(scheduler, Number(time.toFixed(6)));
      for (const [key, value] of Object.entries(pose) as Array<[FACSKey, number]>) {
        const [min, max] = facsRangeForKey(key);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
      }
    }
  });
});
