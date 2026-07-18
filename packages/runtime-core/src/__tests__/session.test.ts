import { describe, expect, it, vi } from "vitest";
import {
  type AudioLevelAnalyzer,
  type ModelProfile,
  type SoullinkExternalPlan
} from "@soullink-emotion/engine";
import { createSoullinkSession } from "../createSoullinkSession";
import { createManualClock } from "../clocks";
import { amanePersona } from "../presets/amanePersona";
import type {
  AudioSink,
  MessageClassifier,
  PlannerClient,
  SessionSnapshot,
  SpeakingMotionInput,
  SpeakingMotionResult,
  TtsClient,
  TtsResult
} from "../types";

function createTestProfile(): ModelProfile {
  return {
    modelId: "runtime-test-avatar",
    displayName: "Runtime Test Avatar",
    version: "1.0.0",
    modelPath: "/models/runtime-test/avatar.model3.json",
    schemaVersion: 2,
    parameterMap: {
      eyeOpen: { targets: ["ParamEyeLOpen", "ParamEyeROpen"], min: 0, max: 1 },
      mouthOpen: { target: "ParamMouthOpenY", min: 0, max: 1 },
      mouthSmile: { target: "ParamMouthForm", min: -1, max: 1 },
      headX: { target: "ParamAngleX", min: -30, max: 30 },
      headY: { target: "ParamAngleY", min: -30, max: 30 },
      headZ: { target: "ParamAngleZ", min: -30, max: 30 },
      bodyX: { target: "ParamBodyAngleX", min: -10, max: 10 },
      breath: { target: "ParamBreath", min: 0, max: 1 }
    },
    idleConfig: {},
    neutralParams: {
      ParamEyeLOpen: 1,
      ParamEyeROpen: 1,
      ParamMouthOpenY: 0,
      ParamMouthForm: 0
    }
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function makeStubs() {
  const calls = { reaction: 0, speakingMotion: 0, tts: 0, play: 0 };

  const reactionIntent = {
    emotion: "happy",
    variant: "soft_smile",
    naturalEmotion: "happy",
    intensity: 0.72,
    contextTags: [] as string[]
  };

  const planner: PlannerClient = {
    async planReaction(): Promise<SoullinkExternalPlan> {
      calls.reaction += 1;
      return {
        intent: reactionIntent,
        replyDraft: "你好呀，我在听。",
        vadTarget: { valence: 0.4, arousal: 0.3, dominance: 0.2 },
        provider: "openai-compatible"
      };
    },
    async planSpeakingMotion(): Promise<SpeakingMotionResult> {
      calls.speakingMotion += 1;
      return {
        parameterPlan: [
          { time: 0, duration: 0.3, label: "beat", parameters: { ParamMouthOpenY: 0.6 } }
        ],
        provider: "fallback"
      };
    }
  };

  const tts: TtsClient = {
    async synthesize() {
      calls.tts += 1;
      return { url: "blob:stub-audio", durationSec: 1.2 };
    }
  };

  const audio: AudioSink = {
    async play() {
      calls.play += 1;
      return { durationSec: 1.2, finished: Promise.resolve() };
    },
    stop() {}
  };

  return { calls, planner, tts, audio };
}

describe("createSoullinkSession", () => {
  it("passes local motion style and audio analysis options to the engine runtime", async () => {
    const profile = createTestProfile();
    let levelReads = 0;
    const analyzer: AudioLevelAnalyzer = {
      getLevel() {
        levelReads += 1;
        return 0.4;
      },
      getPeak() {
        return 0.7;
      },
      isAvailable() {
        return true;
      }
    };

    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      motionStyle: {
        seed: 4242,
        spontaneity: 0.35,
        avoidRepeatWindow: 5
      },
      audioLevelAnalyzer: analyzer
    });
    const runtime = session.getRuntime()!;

    expect(runtime.getMotionStyle()).toMatchObject({
      seed: 4242,
      spontaneity: 0.35,
      avoidRepeatWindow: 5
    });

    runtime.setVoicePlaybackActive(true);
    runtime.update(0, 1 / 60);
    expect(levelReads).toBeGreaterThan(0);
  });

  it("runs the send -> reply -> tts -> speech-motion pipeline and emits snapshots", async () => {
    const profile = createTestProfile();
    const clock = createManualClock(0);
    const { calls, planner, tts, audio } = makeStubs();
    const snapshots: SessionSnapshot[] = [];

    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      planner,
      tts,
      audio,
      clock,
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });

    session.start();

    // Full chain: classify (local fallback) -> reply -> tts -> playback -> speech motion.
    await session.sendMessage("今天过得怎么样", { awaitReply: true });

    // Advance ~30 frames so the runtime renders parameter state.
    let t = 0;
    for (let i = 0; i < 30; i += 1) {
      t += 1 / 60;
      clock.tick(t, 1 / 60);
    }

    session.stop();

    // onSnapshot fired.
    expect(snapshots.length).toBeGreaterThan(0);

    // live2dParams present on the emitted runtime snapshot.
    const last = snapshots[snapshots.length - 1];
    expect(last.runtime).toBeTruthy();
    expect(last.runtime?.live2dParams).toBeDefined();
    expect(Object.keys(last.runtime?.live2dParams ?? {}).length).toBeGreaterThan(0);

    // The reaction + speech-motion + tts + playback paths all ran.
    expect(calls.reaction).toBeGreaterThan(0);
    expect(calls.speakingMotion).toBeGreaterThan(0);
    expect(calls.tts).toBeGreaterThan(0);
    expect(calls.play).toBeGreaterThan(0);

    // Reply text propagated into session state.
    expect(last.lastReply).toBe("你好呀，我在听。");
    expect(last.conversation.some((turn) => turn.role === "assistant")).toBe(true);
    expect(last.voiceStatus).toBe("idle");
  });

  it("classifies optimistically when a classifier is provided", async () => {
    const profile = createTestProfile();
    const clock = createManualClock(0);
    const { planner, tts, audio } = makeStubs();
    let classifyCalls = 0;

    const classifier: MessageClassifier = {
      async classify() {
        classifyCalls += 1;
        return {
          intent: {
            emotion: "curious",
            variant: "tilt",
            intensity: 0.6,
            contextTags: []
          }
        };
      }
    };

    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      planner,
      tts,
      audio,
      classifier,
      clock
    });

    session.start();
    const intent = await session.sendMessage("讲个笑话", { awaitReply: true });
    session.stop();

    expect(classifyCalls).toBe(1);
    expect(intent?.emotion).toBe("curious");
  });

  it("starts a fixed speaking-motion plan before TTS completes", async () => {
    const profile = createTestProfile();
    const clock = createManualClock(0);
    const { planner, audio } = makeStubs();
    const ttsResult = deferred<TtsResult>();
    const motionResult = deferred<SpeakingMotionResult>();
    const events: string[] = [];
    let motionInput: SpeakingMotionInput | undefined;

    const tts: TtsClient = {
      synthesize() {
        events.push("tts");
        return ttsResult.promise;
      }
    };
    planner.planSpeakingMotion = (input) => {
      events.push("planner");
      motionInput = input;
      return motionResult.promise;
    };

    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      planner,
      tts,
      audio,
      clock,
      speakingMotionScheduling: {
        mode: "fixed-parallel",
        fixedFrameCount: 6,
        frameIntervalSec: 0.75
      }
    });

    session.start();
    const speaking = session.speak({ text: "并行生成语音和动作", planSpeakingMotion: true });

    expect(events).toEqual(["tts", "planner"]);
    expect(motionInput?.mode).toBe("fixed-parallel");
    expect(motionInput?.frameCount).toBe(6);
    expect(motionInput?.frameIntervalSec).toBe(0.75);
    expect(motionInput?.durationSec).toBe(4.5);
    expect(session.getSnapshot().voiceStatus).toBe("loading");

    motionResult.resolve({ parameterPlan: [], provider: "vad-facs" });
    await Promise.resolve();
    expect(session.getSnapshot().voiceStatus).toBe("loading");

    ttsResult.resolve({ url: "blob:parallel-audio", durationSec: 8.4 });
    await speaking;
    session.stop();
  });

  it("waits for the real TTS duration before duration-aware planning", async () => {
    const profile = createTestProfile();
    const clock = createManualClock(0);
    const { planner, audio } = makeStubs();
    const ttsResult = deferred<TtsResult>();
    let motionInput: SpeakingMotionInput | undefined;
    let motionCalls = 0;

    const tts: TtsClient = {
      synthesize: () => ttsResult.promise
    };
    planner.planSpeakingMotion = async (input) => {
      motionCalls += 1;
      motionInput = input;
      return { parameterPlan: [], provider: "vad-facs" };
    };

    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      planner,
      tts,
      audio,
      clock,
      speakingMotionScheduling: { mode: "duration", frameIntervalSec: 0.5 }
    });

    session.start();
    const speaking = session.speak({ text: "按实际时长规划", planSpeakingMotion: true });
    expect(motionCalls).toBe(0);

    ttsResult.resolve({ url: "blob:duration-audio", durationSec: 7.25 });
    await speaking;

    expect(motionCalls).toBe(1);
    expect(motionInput?.mode).toBe("duration");
    expect(motionInput?.durationSec).toBe(7.25);
    expect(motionInput?.frameCount).toBeUndefined();
    expect(motionInput?.frameIntervalSec).toBe(0.5);
    session.stop();
  });

  it("uses request VAD/FACS without parameter keyframes for a vad-facs result", async () => {
    const profile = createTestProfile();
    const clock = createManualClock(0);
    const { planner } = makeStubs();
    const ttsResult = deferred<TtsResult>();
    const playbackStarted = deferred<void>();
    const playbackFinished = deferred<void>();

    const tts: TtsClient = {
      synthesize: () => ttsResult.promise
    };
    planner.planSpeakingMotion = async () => ({
      parameterPlan: [],
      provider: "vad-facs",
      fallbackReason: "API key is not configured"
    });
    const audio: AudioSink = {
      async play() {
        playbackStarted.resolve();
        return { durationSec: 2, finished: playbackFinished.promise };
      },
      stop() {
        playbackFinished.resolve();
      }
    };

    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      planner,
      tts,
      audio,
      clock
    });
    session.start();

    const runtime = session.getRuntime()!;
    const startSpeechMotion = vi.spyOn(runtime, "startSpeechMotion");
    const speaking = session.speak({
      text: "我有一点难过",
      emotion: "sad",
      vad: { valence: -0.65, arousal: -0.2, dominance: -0.25 },
      intent: {
        emotion: "sad",
        variant: "downcast",
        naturalEmotion: "sad",
        naturalVAD: { valence: -0.65, arousal: -0.2, dominance: -0.25 },
        intensity: 0.76,
        contextTags: [],
        sourceMessage: "我有一点难过"
      },
      planSpeakingMotion: true
    });

    clock.tick(0.1, 0.1);
    const waitingSnapshot = session.getRuntimeSnapshot();
    expect(session.getSnapshot().voiceStatus).toBe("loading");
    expect(waitingSnapshot?.emotionIntent?.emotion).toBe("sad");
    expect(waitingSnapshot?.runtimeExpression?.emotion).toBe("sad");
    expect(waitingSnapshot?.vad.target.valence).toBeLessThan(0);

    ttsResult.resolve({ url: "blob:vad-facs-audio", durationSec: 2 });
    await playbackStarted.promise;
    await Promise.resolve();
    expect(startSpeechMotion).toHaveBeenCalled();
    expect(startSpeechMotion.mock.calls.at(-1)?.[0]).toBeUndefined();

    clock.tick(0.2, 0.1);
    expect(session.getRuntimeSnapshot()?.plan?.parameterBeatCount).toBe(0);

    playbackFinished.resolve();
    await speaking;
    session.stop();
  });

  it("forwards manual model parameters for calibration preview", async () => {
    const profile = createTestProfile();
    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      clock: createManualClock(0)
    });
    const runtime = session.getRuntime()!;
    const setCustomChannels = vi.spyOn(runtime, "setCustomChannels");

    session.setManualParameters({ Param6: 0.75 });

    expect(setCustomChannels).toHaveBeenCalledWith({ Param6: 0.75 });
    session.stop();
  });

  it("keeps model metadata when previewing a profile for the same model", async () => {
    const profile = createTestProfile();
    const session = createSoullinkSession({
      profile,
      persona: amanePersona,
      clock: createManualClock(0)
    });
    const runtime = session.getRuntime()!;
    const setPrivateVADParameters = vi.spyOn(runtime, "setPrivateVADParameters");
    const metadata = { Param6: { name: "困惑", min: 0, max: 1, default: 0 } };

    session.setSpeakingMotionParameters(metadata);
    setPrivateVADParameters.mockClear();
    session.setProfile({ ...profile, displayName: `${profile.displayName} preview` });

    expect(setPrivateVADParameters).toHaveBeenLastCalledWith(metadata);
    session.stop();
  });
});
