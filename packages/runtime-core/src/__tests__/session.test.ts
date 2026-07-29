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

function createReactionPlan(replyDraft: string): SoullinkExternalPlan {
  return {
    intent: {
      emotion: "happy",
      variant: "soft_smile",
      naturalEmotion: "happy",
      intensity: 0.72,
      contextTags: []
    },
    replyDraft,
    vadTarget: { valence: 0.4, arousal: 0.3, dominance: 0.2 },
    provider: "openai-compatible"
  };
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

  it("keeps user turns ordered and ignores a stale classifier result", async () => {
    const firstClassification = deferred<Awaited<ReturnType<MessageClassifier["classify"]>>>();
    const secondClassification = deferred<Awaited<ReturnType<MessageClassifier["classify"]>>>();
    const reactionInputs: string[] = [];
    const reactionConversations: string[][] = [];

    const classifier: MessageClassifier = {
      classify(message) {
        return message === "first" ? firstClassification.promise : secondClassification.promise;
      }
    };
    const planner: PlannerClient = {
      async planReaction(input) {
        reactionInputs.push(input.message);
        reactionConversations.push(input.conversation.map((turn) => turn.content));
        return createReactionPlan(`${input.message}-reply`);
      }
    };
    const session = createSoullinkSession({
      profile: createTestProfile(),
      persona: amanePersona,
      classifier,
      planner,
      clock: createManualClock(0)
    });

    session.start();
    const first = session.sendMessage("first", { awaitReply: true });
    const second = session.sendMessage("second", { awaitReply: true });

    expect(session.getSnapshot().conversation).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" }
    ]);

    secondClassification.resolve({
      intent: {
        emotion: "curious",
        variant: "tilt",
        intensity: 0.6,
        contextTags: []
      }
    });
    await second;

    firstClassification.resolve({
      intent: {
        emotion: "sad",
        variant: "downcast",
        intensity: 0.6,
        contextTags: []
      }
    });
    await first;

    expect(reactionInputs).toEqual(["second"]);
    expect(reactionConversations).toEqual([["first", "second"]]);
    expect(session.getSnapshot().conversation).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
      { role: "assistant", content: "second-reply" }
    ]);
    expect(session.getSnapshot().planning).toBe(false);
    session.stop();
  });

  it("does not let a stale planner overwrite the latest reply or planning state", async () => {
    const firstPlan = deferred<SoullinkExternalPlan>();
    const secondPlan = deferred<SoullinkExternalPlan>();
    const planner: PlannerClient = {
      planReaction(input) {
        return input.message === "first" ? firstPlan.promise : secondPlan.promise;
      }
    };
    const session = createSoullinkSession({
      profile: createTestProfile(),
      persona: amanePersona,
      planner,
      clock: createManualClock(0)
    });

    session.start();
    const first = session.sendMessage("first", { awaitReply: true });
    const second = session.sendMessage("second", { awaitReply: true });

    secondPlan.resolve(createReactionPlan("second-reply"));
    await second;
    expect(session.getSnapshot().lastReply).toBe("second-reply");
    expect(session.getSnapshot().planning).toBe(false);

    firstPlan.reject(new Error("stale failure"));
    await first;

    expect(session.getSnapshot().lastReply).toBe("second-reply");
    expect(session.getSnapshot().apiError).toBeNull();
    expect(session.getSnapshot().conversation).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
      { role: "assistant", content: "second-reply" }
    ]);
    expect(session.getSnapshot().planning).toBe(false);
    session.stop();
  });

  it.each(["resolve", "reject"] as const)(
    "invalidates a pending reflection when a new message starts (%s)",
    async (outcome) => {
      const secondPlan = deferred<SoullinkExternalPlan>();
      const oldReflection = deferred<{
        thought: string;
        reason: string;
        emotion?: string;
        vadTarget?: { valence: number; arousal: number; dominance: number };
      }>();
      const clock = createManualClock(0);
      let reflectionCalls = 0;
      const planner: PlannerClient = {
        planReaction(input) {
          return input.message === "first"
            ? Promise.resolve(createReactionPlan("first-reply"))
            : secondPlan.promise;
        },
        planReflection() {
          reflectionCalls += 1;
          return oldReflection.promise;
        }
      };
      const session = createSoullinkSession({
        profile: createTestProfile(),
        persona: amanePersona,
        planner,
        clock,
        reflectionIdleDelaySeconds: 0
      });

      session.start();
      await session.sendMessage("first", { awaitReply: true });
      for (let step = 1; step <= 100 && reflectionCalls === 0; step += 1) {
        clock.tick(step * 0.1, 0.1);
      }
      expect(reflectionCalls).toBe(1);

      const second = session.sendMessage("second", { awaitReply: true });
      if (outcome === "resolve") {
        oldReflection.resolve({
          thought: "stale-thought",
          reason: "old turn",
          emotion: "sad",
          vadTarget: { valence: -0.8, arousal: 0.2, dominance: -0.4 }
        });
      } else {
        oldReflection.reject(new Error("stale reflection failure"));
      }
      await Promise.resolve();
      await Promise.resolve();
      const staleThought = session.getRuntime().getSnapshot().reflection?.thought;
      const staleError = session.getSnapshot().apiError;

      secondPlan.resolve(createReactionPlan("second-reply"));
      await second;
      session.stop();

      expect(staleThought).not.toBe("stale-thought");
      expect(staleError).toBeNull();
    }
  );

  it.each(["stop", "reset"] as const)(
    "%s invalidates a pending reaction without publishing its late result",
    async (action) => {
      const pendingPlan = deferred<SoullinkExternalPlan>();
      const planner: PlannerClient = {
        planReaction: () => pendingPlan.promise
      };
      const session = createSoullinkSession({
        profile: createTestProfile(),
        persona: amanePersona,
        planner,
        clock: createManualClock(0)
      });

      session.start();
      const request = session.sendMessage("pending", { awaitReply: true });
      expect(session.getSnapshot().planning).toBe(true);

      session[action]();
      pendingPlan.resolve(createReactionPlan("late-reply"));
      await request;

      expect(session.getSnapshot().planning).toBe(false);
      expect(session.getSnapshot().lastReply).toBe("");
      expect(session.getSnapshot().apiError).toBeNull();
      expect(session.getSnapshot().conversation.some((turn) => turn.role === "assistant")).toBe(false);
    }
  );

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
