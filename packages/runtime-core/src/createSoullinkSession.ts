import {
  getVADPreset,
  SoullinkRuntime,
  type EmotionIntent,
  type ModelProfile,
  type PartialFACSActionUnitState,
  type PartialFACSLikeState,
  type RuntimeSnapshot,
  type SoullinkParameterBeat,
  type SoullinkProactiveEvent,
  type VADVector
} from "@soullink-emotion/engine";
import { createRafClock } from "./clocks";
import type {
  AudioSink,
  Clock,
  DeliverProactiveOptions,
  MessageClassifier,
  MotionParameterInfo,
  PersonaConfig,
  PlannerClient,
  ProactiveDraft,
  ProactivePlanResult,
  SessionSnapshot,
  SpeakingMotionInput,
  SpeakingMotionResult,
  SpeakingMotionSchedulingConfig,
  SoullinkSession,
  SoullinkSessionOptions,
  SpeakRequest,
  TriggerIntentOptions,
  TtsClient,
  VoiceStatus
} from "./types";

const DEFAULT_REFLECTION_IDLE_DELAY_SECONDS = 5;
const DEFAULT_SPEAKING_MOTION_SCHEDULING = {
  mode: "fixed-parallel",
  fixedFrameCount: 4,
  frameIntervalSec: 1
} as const;

/**
 * Headless, framework-agnostic orchestrator. Owns the engine SoullinkRuntime and
 * drives the reaction / proactive / reflection / voice-playback loops through
 * injected ports (clock, audio, planner, tts, classifier). No requestAnimationFrame,
 * Audio, localStorage, or DOM access lives here.
 */
export function createSoullinkSession(options: SoullinkSessionOptions): SoullinkSession {
  const persona: PersonaConfig = options.persona;
  const planner: PlannerClient | undefined = options.planner;
  const tts: TtsClient | undefined = options.tts;
  const classifier: MessageClassifier | undefined = options.classifier;
  const clock: Clock = options.clock ?? createRafClock();
  const audio: AudioSink | undefined = options.audio;
  const onSnapshot = options.onSnapshot;
  const reflectionIdleDelaySeconds =
    options.reflectionIdleDelaySeconds ?? DEFAULT_REFLECTION_IDLE_DELAY_SECONDS;
  const speakingMotionScheduling = resolveSpeakingMotionScheduling(options.speakingMotionScheduling);

  const runtime = new SoullinkRuntime({
    profile: options.profile,
    motionStyle: options.motionStyle,
    audioLevelAnalyzer: options.audioLevelAnalyzer
  });
  let profile: ModelProfile = options.profile;

  // ---- reactive-ish session state (mirrored by the host via onSnapshot) ----
  let runtimeSnapshot: RuntimeSnapshot | null = null;
  let planning = false;
  let apiError: string | null = null;
  let lastReply = "";
  let voiceStatus: VoiceStatus = "idle";
  let autoVoiceEnabled = true;
  let proactiveDraft: ProactiveDraft | null = null;
  let conversation: { role: "user" | "assistant"; content: string }[] = [];
  let speakingMotionParameters: Record<string, MotionParameterInfo> = {};

  // ---- loop / lifecycle bookkeeping ----
  let started = false;
  let currentTime = clock.now?.() ?? 0;

  // reflection scheduling
  let pendingReflectionTopic = "";
  let idleReflectionStartedAt: number | null = null;
  let reflectionTriggeredForTurn = false;
  let reflectionRequestId = 0;

  // voice playback state machine
  let voiceRequestId = 0;
  let currentPlaybackSettle: (() => void) | null = null;

  // proactive draft dedupe
  let proactiveDraftRequestId = 0;
  let lastProactiveEventId = "";

  function now(): number {
    return clock.now?.() ?? currentTime;
  }

  function emit(): void {
    if (!onSnapshot) return;
    onSnapshot(getSnapshot());
  }

  function getSnapshot(): SessionSnapshot {
    return {
      runtime: runtimeSnapshot,
      planning,
      apiError,
      lastReply,
      voiceStatus,
      autoVoiceEnabled,
      proactiveDraft,
      conversation
    };
  }

  // ---------------------------------------------------------------- tick loop

  function tick(tickNow: number, dt: number): void {
    currentTime = tickNow;
    const delta = Math.min(0.05, dt || 1 / 60);

    const updated = runtime.update(tickNow, delta);

    if (triggerProactivePresetLoop(updated.proactive, tickNow)) {
      runtimeSnapshot = runtime.update(tickNow, 0);
      queueProactiveDraft(null);
    } else {
      runtimeSnapshot = updated;
      queueProactiveDraft(updated.proactive);
    }

    updateIdleReflectionTrigger(tickNow);
    emit();
  }

  function start(): void {
    if (started) return;
    started = true;
    // Prime an initial snapshot so hosts render before the first frame.
    runtimeSnapshot = runtime.getSnapshot();
    emit();
    clock.start(tick);
  }

  function stop(): void {
    if (!started) return;
    started = false;
    clock.stop();
    stopVoice();
  }

  // ------------------------------------------------------------- send message

  async function sendMessage(
    message: string,
    sendOptions: { awaitReply?: boolean } = {}
  ): Promise<EmotionIntent | null> {
    if (!message.trim()) return null;
    const currentVAD = runtimeSnapshot?.vad.current;
    const userTurn = { role: "user" as const, content: message };

    planning = true;
    apiError = null;
    emit();

    let immediateIntent: EmotionIntent | null = null;

    try {
      if (!classifier) throw new Error("no-classifier");
      const result = await classifier.classify(message);
      immediateIntent = result.intent;
      runtime.triggerIntent(immediateIntent, now());
      conversation = [...conversation, userTurn];
    } catch {
      // Fallback to the engine's local classifier.
      immediateIntent = runtime.sendMessage(message, now());
      conversation = [...conversation, userTurn];
    }
    emit();

    // Background: LLM reply -> TTS -> playback -> speech motion. `awaitReply`
    // (serial danmaku queue) waits the whole chain; the default (manual chat)
    // returns immediately so a newer message can preempt older speech.
    const replyTask = runReactionReply(message, immediateIntent, currentVAD)
      .finally(() => {
        planning = false;
        emit();
      });

    if (sendOptions.awaitReply) {
      await replyTask;
    }

    return immediateIntent;
  }

  async function runReactionReply(
    message: string,
    immediateIntent: EmotionIntent | null,
    currentVAD: VADVector | undefined
  ): Promise<void> {
    if (!planner?.planReaction) {
      armIdleReflection(message);
      return;
    }

    try {
      const plan = await planner.planReaction({
        message,
        conversation,
        characterName: persona.name,
        characterProfile: persona.profile,
        vad: currentVAD
      });

      if (plan.replyDraft) {
        conversation = [...conversation, { role: "assistant", content: plan.replyDraft }];
        lastReply = plan.replyDraft;
        emit();

        if (plan.vadTarget) {
          runtime.applyVADTarget(plan.vadTarget, 0.5);
        }

        await speak({
          text: plan.replyDraft,
          emotion: plan.intent.naturalEmotion ?? plan.intent.emotion,
          vad: plan.vadTarget ?? plan.intent.naturalVAD ?? currentVAD,
          intent: plan.intent,
          planSpeakingMotion: true,
          userMessage: message
        });
      }
      armIdleReflection(message);
    } catch (cause) {
      apiError = `API fallback: ${describeError(cause)}`;
      const fallbackReply = createFallbackReply(immediateIntent?.emotion ?? "neutral");
      conversation = [...conversation, { role: "assistant", content: fallbackReply }];
      lastReply = fallbackReply;
      emit();
      armIdleReflection(message);
    }
  }

  // ------------------------------------------------------------ intents / plan

  function triggerIntent(intent: EmotionIntent, triggerOptions?: TriggerIntentOptions): void {
    runtime.triggerIntent(intent, now(), triggerOptions);
  }

  function triggerProactivePresetLoop(event: RuntimeSnapshot["proactive"], atTime: number): boolean {
    if (!event?.reason.startsWith("repeat_vad_preset:")) return false;

    runtime.triggerIntent(proactiveIntent(event.emotion, event.intensity, event.suggestedMessage), atTime, {
      provider: "local",
      replyDraft: ""
    });
    runtime.consumeProactive();
    proactiveDraft = null;
    lastProactiveEventId = "";

    return true;
  }

  // ----------------------------------------------------------------- proactive

  async function planProactive(event: SoullinkProactiveEvent): Promise<ProactivePlanResult> {
    if (!planner?.planProactive) {
      return {
        message: event.suggestedMessage,
        emotion: event.emotion,
        reason: event.reason,
        provider: "local"
      };
    }
    return planner.planProactive({
      characterName: persona.name,
      characterProfile: persona.profile,
      proactive: event,
      conversation,
      reflection: runtimeSnapshot?.reflection ?? null,
      vad: runtimeSnapshot?.vad.current
    });
  }

  async function acceptProactive(): Promise<void> {
    const event = runtimeSnapshot?.proactive;
    if (!event) return;

    planning = true;
    apiError = null;
    emit();

    try {
      const plan =
        proactiveDraft?.eventId === event.id && proactiveDraft.status === "ready"
          ? draftToPlan(proactiveDraft)
          : await planProactive(event);
      const intent = proactiveIntent(plan.emotion, event.intensity, plan.message);

      runtime.triggerIntent(intent, now(), { provider: plan.provider, replyDraft: plan.message });
      runtime.consumeProactive();
      proactiveDraft = null;
      lastProactiveEventId = "";
      pushAssistantTurn(plan.message);
      void speak({
        text: plan.message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current
      });
    } catch (cause) {
      apiError = `Proactive fallback: ${describeError(cause)}`;
      const message = event.suggestedMessage;
      runtime.triggerIntent(proactiveIntent(event.emotion, event.intensity, message), now(), {
        provider: "local",
        replyDraft: message
      });
      runtime.consumeProactive();
      proactiveDraft = null;
      lastProactiveEventId = "";
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: event.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current
      });
    } finally {
      planning = false;
      emit();
    }
  }

  /**
   * Generic "plan a proactive line and speak it" used by host-side platform
   * triggers (e.g. bilibili idle warmup) that build their own event. Platform
   * specifics stay in the host and are passed via `options`.
   */
  async function deliverProactive(
    event: SoullinkProactiveEvent,
    deliverOptions: DeliverProactiveOptions = {}
  ): Promise<boolean> {
    planning = true;
    apiError = null;
    emit();

    try {
      const plan = await planProactive(event);
      const rawMessage = plan.message || event.suggestedMessage;
      const message = deliverOptions.transformMessage ? deliverOptions.transformMessage(rawMessage) : rawMessage;
      const intent = proactiveIntent(
        plan.emotion || deliverOptions.fallbackEmotion || event.emotion,
        event.intensity,
        message
      );

      runtime.triggerIntent(intent, now(), { provider: plan.provider, replyDraft: message });
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current,
        intent,
        planSpeakingMotion: true
      });
      return true;
    } catch (cause) {
      apiError = `${deliverOptions.errorLabel ?? "Proactive fallback"}: ${describeError(cause)}`;
      const message = event.suggestedMessage;
      const intent = proactiveIntent(deliverOptions.fallbackEmotion || event.emotion, event.intensity, message);

      runtime.triggerIntent(intent, now(), { provider: "local", replyDraft: message });
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current,
        intent,
        planSpeakingMotion: true
      });
      return true;
    } finally {
      planning = false;
      emit();
    }
  }

  function queueProactiveDraft(event: RuntimeSnapshot["proactive"]): void {
    if (!event) {
      if (proactiveDraft) proactiveDraft = null;
      lastProactiveEventId = "";
      return;
    }

    if (event.id === lastProactiveEventId) return;

    lastProactiveEventId = event.id;
    const requestId = ++proactiveDraftRequestId;
    proactiveDraft = {
      eventId: event.id,
      status: "loading",
      message: "",
      emotion: event.emotion,
      reason: event.reason,
      provider: "local"
    };

    void planProactive(event)
      .then((plan) => {
        if (requestId !== proactiveDraftRequestId || runtimeSnapshot?.proactive?.id !== event.id) return;
        proactiveDraft = {
          eventId: event.id,
          status: "ready",
          message: plan.message,
          emotion: plan.emotion,
          reason: plan.reason,
          provider: plan.provider
        };
        emit();
      })
      .catch((cause) => {
        if (requestId !== proactiveDraftRequestId || runtimeSnapshot?.proactive?.id !== event.id) return;
        proactiveDraft = {
          eventId: event.id,
          status: "error",
          message: softerProactiveFallback(event.emotion),
          emotion: event.emotion,
          reason: describeError(cause),
          provider: "local"
        };
        emit();
      });
  }

  function pushAssistantTurn(content: string): void {
    conversation = [...conversation, { role: "assistant", content }];
    lastReply = content;
    emit();
  }

  // ---------------------------------------------------------------- reflection

  async function requestReflection(topic?: string): Promise<void> {
    if (!planner?.planReflection) return;
    const requestId = ++reflectionRequestId;
    if (pendingReflectionTopic) reflectionTriggeredForTurn = true;

    try {
      const plan = await planner.planReflection({
        conversation,
        vad: runtimeSnapshot?.vad.current,
        topic,
        characterName: persona.name,
        characterProfile: persona.profile
      });
      if (requestId !== reflectionRequestId) return;

      runtime.setReflection(
        {
          thought: plan.thought,
          reason: plan.reason,
          emotion: plan.emotion,
          vadTarget: plan.vadTarget
        },
        now()
      );
    } catch (cause) {
      apiError = `Reflection skipped: ${describeError(cause)}`;
      emit();
    }
  }

  function armIdleReflection(topic: string): void {
    reflectionRequestId += 1;
    pendingReflectionTopic = topic;
    idleReflectionStartedAt = null;
    reflectionTriggeredForTurn = false;
  }

  function clearIdleReflectionTrigger(): void {
    reflectionRequestId += 1;
    pendingReflectionTopic = "";
    idleReflectionStartedAt = null;
    reflectionTriggeredForTurn = false;
  }

  function updateIdleReflectionTrigger(atTime: number): void {
    if (!pendingReflectionTopic || reflectionTriggeredForTurn || !runtimeSnapshot) return;

    const dialogueSettled =
      runtimeSnapshot.state === "IDLE" && voiceStatus !== "loading" && voiceStatus !== "playing";

    if (!dialogueSettled) {
      idleReflectionStartedAt = null;
      return;
    }

    idleReflectionStartedAt ??= atTime;

    if (atTime - idleReflectionStartedAt < reflectionIdleDelaySeconds) return;

    reflectionTriggeredForTurn = true;
    void requestReflection(pendingReflectionTopic);
  }

  // -------------------------------------------------------------- voice / TTS

  async function synthesizeLastReply(): Promise<void> {
    await speak({
      text: lastReply,
      emotion: runtimeSnapshot?.vad.dominantEmotion ?? runtimeSnapshot?.emotionIntent?.emotion,
      vad: runtimeSnapshot?.vad.current,
      force: true
    });
  }

  function primeSpeakingEmotionState(request: SpeakRequest): void {
    // Flush any VAD target already applied by reaction planning before deciding
    // whether this speech request needs another nudge.
    const snapshot = runtime.update(now(), 0);
    const requestedIntent = request.intent ?? createSpeakingIntent(request, snapshot);
    const requestedVAD = request.vad ?? requestedIntent?.naturalVAD;

    if (requestedIntent && !sameSpeakingIntent(snapshot.emotionIntent, requestedIntent)) {
      runtime.triggerIntent(requestedIntent, now(), {
        ...(requestedVAD ? { vadTarget: requestedVAD } : {}),
        provider: "vad-facs"
      });
    } else if (requestedVAD && !matchesVAD(snapshot.vad.target, requestedVAD)) {
      runtime.applyVADTarget(requestedVAD, 0.45);
    }
  }

  function createSpeakingIntent(request: SpeakRequest, snapshot: RuntimeSnapshot): EmotionIntent | null {
    const emotion = request.emotion?.trim();
    if (!emotion) return null;

    const variant = persona.variantByEmotion[emotion] ?? "neutral_ack";
    return {
      emotion,
      variant,
      naturalEmotion: emotion,
      naturalVAD: request.vad ?? getVADPreset(emotion, variant),
      intensity: clampNumber(snapshot.vad.intensity || 0.6, 0.35, 1),
      contextTags: ["speaking"],
      sourceMessage: request.text
    };
  }

  function buildSpeakingMotionInput(
    request: SpeakRequest,
    durationSec: number,
    mode: "duration" | "fixed-parallel"
  ): SpeakingMotionInput {
    const snapshot = runtime.getSnapshot();
    return {
      speechText: request.text,
      durationSec,
      mode,
      ...(mode === "fixed-parallel" ? { frameCount: speakingMotionScheduling.fixedFrameCount } : {}),
      frameIntervalSec: speakingMotionScheduling.frameIntervalSec,
      availableParameters: buildSpeakingMotionParameters(speakingMotionParameters, profile),
      intent: request.intent ?? snapshot.emotionIntent ?? undefined,
      vad: request.vad ?? snapshot.vad.current,
      expression: snapshot.runtimeExpression
        ? {
            emotion: snapshot.runtimeExpression.emotion,
            variant: snapshot.runtimeExpression.variant,
            intensity: snapshot.runtimeExpression.intensity,
            peakFACS: snapshot.runtimeExpression.peakFACS
          }
        : null,
      characterName: persona.name,
      characterProfile: persona.profile,
      userMessage: request.userMessage
    };
  }

  async function requestSpeakingMotion(
    input: SpeakingMotionInput,
    requestId: number
  ): Promise<SpeakingMotionResult> {
    try {
      return await planner!.planSpeakingMotion!(input);
    } catch (cause) {
      const fallbackReason = describeError(cause);
      if (requestId === voiceRequestId && voiceStatus === "loading") {
        apiError = `Speaking motion skipped: ${fallbackReason}`;
        emit();
      }
      return { parameterPlan: [], provider: "vad-facs", fallbackReason };
    }
  }

  async function speak(request: SpeakRequest): Promise<void> {
    if (!request.text.trim()) return;
    if (!request.force && !autoVoiceEnabled) return;
    if (!tts || !audio) return;

    stopVoice();
    const requestId = ++voiceRequestId;

    // This clip's "playback settled" signal. Resolved on end / error / preempt /
    // manual stop (never rejected) so serial callers stop waiting.
    let settlePlayback: () => void = () => {};
    const playbackFinished = new Promise<void>((resolve) => {
      settlePlayback = resolve;
    });
    const finished = () => {
      if (currentPlaybackSettle === settlePlayback) currentPlaybackSettle = null;
      settlePlayback();
    };
    currentPlaybackSettle = settlePlayback;

    primeSpeakingEmotionState(request);
    const waitingMotionSeed = createVoiceWaitingMotionSeed(request.text, request.emotion, requestId, now());
    const waitingMotionContext = {
      emotion:
        request.emotion ??
        request.intent?.naturalEmotion ??
        request.intent?.emotion ??
        runtimeSnapshot?.vad.dominantEmotion ??
        runtimeSnapshot?.emotionIntent?.emotion,
      intensity: request.intent?.intensity ?? runtimeSnapshot?.vad.intensity,
      vad: request.vad ?? request.intent?.naturalVAD ?? runtimeSnapshot?.vad.current
    };
    runtime.startVoiceWaitingMotion(now(), waitingMotionSeed, waitingMotionContext);
    runtimeSnapshot = runtime.update(now(), 0);
    voiceStatus = "loading";
    emit();

    try {
      const ttsTask = tts.synthesize(request.text, {
        emotion: request.emotion,
        vad: request.vad,
        intent: request.intent
      });
      const shouldPlanSpeakingMotion = Boolean(request.planSpeakingMotion && planner?.planSpeakingMotion);
      const parallelMotionTask =
        shouldPlanSpeakingMotion && speakingMotionScheduling.mode === "fixed-parallel"
          ? requestSpeakingMotion(
              buildSpeakingMotionInput(
                request,
                speakingMotionScheduling.fixedFrameCount * speakingMotionScheduling.frameIntervalSec,
                "fixed-parallel"
              ),
              requestId
            )
          : null;

      const [result, parallelMotion] = parallelMotionTask
        ? await Promise.all([ttsTask, parallelMotionTask])
        : [await ttsTask, null];
      if (requestId !== voiceRequestId) return finished();

      const durationSec = result.durationSec ?? estimateSpeechDurationFromText(request.text);
      const motion =
        parallelMotion ??
        (shouldPlanSpeakingMotion
          ? await requestSpeakingMotion(buildSpeakingMotionInput(request, durationSec, "duration"), requestId)
          : null);
      const pendingSpeechMotion: SoullinkParameterBeat[] | undefined =
        motion?.provider !== "vad-facs" && motion?.parameterPlan?.length
          ? motion.parameterPlan
          : undefined;

      if (requestId !== voiceRequestId) return finished();
      voiceStatus = "playing";
      emit();

      const playback = await audio.play({ url: result.url, bytes: result.bytes });
      if (requestId !== voiceRequestId) return finished();

      const playbackStart = now();
      // Starting the speaking state without a parameter plan leaves motion to
      // the request's VAD/FACS expression and LipSync; no local keyframes exist.
      runtime.startSpeechMotion(pendingSpeechMotion, playbackStart, durationSec);
      runtime.setVoicePlaybackActive(true);

      // Natural end / error / stop -> settle the runtime motion state.
      void Promise.resolve(playback.finished).then(() => {
        if (requestId === voiceRequestId) {
          voiceStatus = "idle";
          runtime.setVoicePlaybackActive(false);
          runtime.clearVoiceWaitingMotion();
          runtime.clearSpeechMotion();
          emit();
        }
        finished();
      });

      // Wait until this clip truly finishes (or is preempted by a newer clip).
      await playbackFinished;
    } catch (cause) {
      if (requestId !== voiceRequestId) return finished();
      apiError = `Voice failed: ${describeError(cause)}`;
      runtime.setVoicePlaybackActive(false);
      runtime.clearVoiceWaitingMotion();
      runtime.clearSpeechMotion();
      voiceStatus = "error";
      emit();
      finished();
    }
  }

  function stopVoice(): void {
    voiceRequestId += 1;
    runtime.setVoicePlaybackActive(false);
    runtime.clearVoiceWaitingMotion();
    audio?.stop();
    runtime.clearSpeechMotion();

    if (currentPlaybackSettle) {
      const settle = currentPlaybackSettle;
      currentPlaybackSettle = null;
      settle();
    }
  }

  function setAutoVoiceEnabled(enabled: boolean): void {
    autoVoiceEnabled = enabled;
    if (!enabled) {
      stopVoice();
      if (voiceStatus === "loading" || voiceStatus === "playing") {
        voiceStatus = "idle";
      }
    }
    emit();
  }

  // ----------------------------------------------------------------- lifecycle

  function reset(): void {
    runtime.reset(now());
    lastReply = "";
    conversation = [];
    apiError = null;
    clearIdleReflectionTrigger();
    proactiveDraft = null;
    lastProactiveEventId = "";
    stopVoice();
    voiceStatus = "idle";
    runtimeSnapshot = runtime.getSnapshot();
    emit();
  }

  function setProfile(nextProfile: ModelProfile): void {
    const modelChanged = nextProfile.modelPath !== profile.modelPath || nextProfile.modelId !== profile.modelId;
    profile = nextProfile;
    if (modelChanged) speakingMotionParameters = {};
    runtime.setProfile(nextProfile);
    runtime.setPrivateVADParameters(speakingMotionParameters);
    runtimeSnapshot = runtime.getSnapshot();
    emit();
  }

  function setSpeakingMotionParameters(parameters: Record<string, MotionParameterInfo>): void {
    speakingMotionParameters = parameters;
    runtime.setPrivateVADParameters(parameters);
  }

  // ------------------------------------------------------- proactive intent

  function proactiveIntent(emotion: string, intensity: number, sourceMessage: string): EmotionIntent {
    const variant = persona.variantByEmotion[emotion] ?? "neutral_ack";
    return {
      emotion,
      variant,
      naturalEmotion: emotion,
      naturalVAD: getVADPreset(emotion, variant),
      intensity: Math.max(0.62, Math.min(0.86, intensity || 0.68)),
      contextTags: ["proactive_idle"],
      sourceMessage
    };
  }

  function createFallbackReply(emotion: string): string {
    return persona.fallbacks?.[emotion] ?? persona.fallbacks?.neutral ?? "嗯，我在。";
  }

  function softerProactiveFallback(emotion: string): string {
    return (
      persona.proactiveFallbacks?.[emotion] ??
      persona.proactiveFallbacks?.neutral ??
      "我刚刚有点走神想到你了，就轻轻冒个头。"
    );
  }

  return {
    start,
    stop,
    sendMessage,
    triggerIntent,
    acceptProactive,
    deliverProactive,
    planProactive,
    pushAssistantTurn,
    requestReflection,
    synthesizeLastReply,
    speak,
    stopVoice,
    reset,
    setProfile,
    getSnapshot,
    getRuntimeSnapshot: () => runtimeSnapshot,
    getRuntime: () => runtime,
    getProfile: () => profile,
    setSpeakingMotionParameters,
    setAutoVoiceEnabled,
    setIdleEnabled: (enabled: boolean) => runtime.setIdleEnabled(enabled),
    setLipSyncEnabled: (enabled: boolean) => runtime.setLipSyncEnabled(enabled),
    setManualFACS: (facs: PartialFACSLikeState) => runtime.setManualFACS(facs),
    setManualActionUnits: (actionUnits: PartialFACSActionUnitState) => runtime.setManualActionUnits(actionUnits),
    setManualParameters: (parameters: Record<string, number>) => runtime.setCustomChannels(parameters),
    setParameterGain: (gain: number) => runtime.setParameterGain(gain),
    setBodyMotionGain: (gain: number) => runtime.setBodyMotionGain(gain),
    setVADDecayRate: (rate: number) => runtime.setVADDecayRate(rate),
    setProactiveRepeatEnabled: (enabled: boolean) => runtime.setProactiveRepeatEnabled(enabled)
  };
}

// ---------------------------------------------------------------- pure helpers

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function draftToPlan(draft: ProactiveDraft): ProactivePlanResult {
  return {
    message: draft.message,
    emotion: draft.emotion,
    reason: draft.reason,
    provider: draft.provider === "openai-compatible" ? "openai-compatible" : "fallback"
  };
}

function estimateSpeechDurationFromText(text: string): number {
  const visibleLength = text.replace(/\s+/gu, "").length;
  return Math.max(0.8, Math.min(30, visibleLength * 0.16));
}

function resolveSpeakingMotionScheduling(
  config: SpeakingMotionSchedulingConfig | undefined
): Required<SpeakingMotionSchedulingConfig> {
  const requestedFrameCount = Number.isFinite(config?.fixedFrameCount)
    ? config!.fixedFrameCount!
    : DEFAULT_SPEAKING_MOTION_SCHEDULING.fixedFrameCount;
  const requestedFrameInterval = Number.isFinite(config?.frameIntervalSec)
    ? config!.frameIntervalSec!
    : DEFAULT_SPEAKING_MOTION_SCHEDULING.frameIntervalSec;

  return {
    mode: config?.mode === "duration" ? "duration" : DEFAULT_SPEAKING_MOTION_SCHEDULING.mode,
    fixedFrameCount: clampNumber(Math.round(requestedFrameCount), 1, 120),
    frameIntervalSec: clampNumber(requestedFrameInterval, 0.1, 30)
  };
}

function sameSpeakingIntent(current: EmotionIntent | null, requested: EmotionIntent): boolean {
  if (!current) return false;
  return (
    current.emotion === requested.emotion &&
    (current.variant ?? "") === (requested.variant ?? "") &&
    Math.abs(current.intensity - requested.intensity) <= 0.08
  );
}

function matchesVAD(current: VADVector, requested: Partial<VADVector>): boolean {
  const axes: (keyof VADVector)[] = ["valence", "arousal", "dominance"];
  return axes.every((axis) => requested[axis] === undefined || Math.abs(current[axis] - requested[axis]!) <= 0.04);
}

function createVoiceWaitingMotionSeed(
  text: string,
  emotion: string | undefined,
  requestId: number,
  timeSeconds: number
): number {
  let hash = 2166136261;
  const input = `${text}|${emotion ?? ""}|${requestId}|${Math.round(timeSeconds * 1000)}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function buildSpeakingMotionParameters(
  cdiParameters: Record<string, MotionParameterInfo>,
  modelProfile: ModelProfile | null
): Record<string, MotionParameterInfo> {
  if (Object.keys(cdiParameters).length > 0) return cdiParameters;
  return buildProfileMotionParameters(modelProfile);
}

function buildProfileMotionParameters(modelProfile: ModelProfile | null): Record<string, MotionParameterInfo> {
  if (!modelProfile) return {};
  const result: Record<string, MotionParameterInfo> = {};

  const add = (id: string | undefined, min?: number, max?: number) => {
    if (!id) return;
    const fallback = defaultParameterInfo(id, modelProfile.neutralParams?.[id]);
    const nextMin = Number.isFinite(min) ? (min as number) : fallback.min;
    const nextMax = Number.isFinite(max) ? (max as number) : fallback.max;
    const normalizedMin = Math.min(nextMin, nextMax);
    const normalizedMax = Math.max(nextMin, nextMax);
    const defaultValue = clampNumber(modelProfile.neutralParams?.[id] ?? fallback.default, normalizedMin, normalizedMax);
    const existing = result[id];

    result[id] = existing
      ? {
          name: id,
          min: Math.min(existing.min, normalizedMin),
          max: Math.max(existing.max, normalizedMax),
          default: defaultValue
        }
      : {
          name: id,
          min: normalizedMin,
          max: normalizedMax,
          default: defaultValue
        };
  };

  for (const rule of Object.values(modelProfile.parameterMap)) {
    if (!rule) continue;
    const targets = rule.targets?.length ? rule.targets : rule.target ? [rule.target] : [];
    for (const target of targets) add(target, rule.min, rule.max);
  }

  for (const id of Object.keys(modelProfile.neutralParams ?? {})) {
    add(id);
  }

  return result;
}

function defaultParameterInfo(id: string, defaultValue = 0): { min: number; max: number; default: number } {
  const normalized = id.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
  if (normalized.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (normalized.includes("eyeball") || normalized.includes("mouthform") || normalized.includes("brow")) {
    return { min: -1, max: 1, default: 0 };
  }
  if (normalized.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: defaultValue };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
