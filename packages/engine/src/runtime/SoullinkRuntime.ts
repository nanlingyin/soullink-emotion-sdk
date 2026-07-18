import { createDefaultFACSState } from "../facs/defaultFACSState";
import { createDefaultActionUnitState } from "../facs/defaultActionUnitState";
import { addFACS, clampFACSState, scaleFACSFromNeutral } from "../facs/FACSUtils";
import type { FACSActionUnitState, PartialFACSActionUnitState } from "../facs/FACSActionUnitState";
import type { FACSLikeState, Live2DParamState, PartialFACSLikeState } from "../facs/FACSLikeState";
import { clamp } from "../utils/clamp";
import { EmotionStateController, type EmotionPersonality } from "../emotion/EmotionStateController";
import { ProactiveController } from "../emotion/ProactiveController";
import { ReflectionPulseController } from "../emotion/ReflectionPulseController";
import { VADExpressionMapper, type VADExpressionResidue } from "../emotion/VADExpressionMapper";
import { VADGestureController } from "../emotion/VADGestureController";
import { VADMicroMotionController } from "../emotion/VADMicroMotionController";
import { VADPrivateParameterOverlay, type VADPrivateParameterInfo } from "../emotion/VADPrivateParameterOverlay";
import type { VADRuntimeState, VADVector } from "../emotion/VADState";
import { ActionUnitSolver } from "../expression/ActionUnitSolver";
import { RuntimeExpressionGenerator, type CharacterPersonality } from "../expression/RuntimeExpressionGenerator";
import type { RuntimeExpression } from "../expression/EmotionArchetype";
import { IdleActionScheduler } from "../idle/IdleActionScheduler";
import { IdleEngine } from "../idle/IdleEngine";
import { LayeredParameterMixer } from "../mixer/LayeredParameterMixer";
import { MotionMixer } from "../mixer/MotionMixer";
import { ModelProfileAdapter } from "../profile/ModelProfileAdapter";
import { resolveNativeAnimation } from "../profile/NativeAnimationResolver";
import { deriveNeutralParams, deriveParameterRanges } from "../profile/deriveProfileDefaults";
import type { ModelProfile, NativeAnimationDirective } from "../profile/ModelProfile";
import type { EmotionIntent } from "../reaction/EmotionIntent";
import { ActionPlanSequencer } from "../reaction/ActionPlanSequencer";
import { MessageReactionClassifier } from "../reaction/MessageReactionClassifier";
import { ParameterPlanSequencer } from "../reaction/ParameterPlanSequencer";
import { ReactionSequencer } from "../reaction/ReactionSequencer";
import { RecoveryController } from "../reaction/RecoveryController";
import type {
  SoullinkActionBeat,
  SoullinkExternalPlan,
  SoullinkParameterBeat,
  SoullinkPlanRuntimeState,
  SoullinkProactiveEvent,
  SoullinkReflectionState
} from "../reaction/SoullinkPlan";
import { estimateMockSpeechDuration } from "../speech/MockSpeechController";
import type { AudioLevelAnalyzer } from "../speech/AudioLevelAnalyzer";
import { LipSyncController } from "../speech/LipSyncController";
import { VoiceWaitingMotionController, type VoiceWaitingMotionOptions } from "../speech/VoiceWaitingMotionController";
import { CharacterStateMachine } from "../state/CharacterStateMachine";
import type { CharacterState } from "../state/CharacterState";
import { seededRandom, type RandomSource } from "../utils/seededRandom";
import {
  deriveMotionSeed,
  resolveMotionStyle,
  type MotionStyleOptions,
  type ResolvedMotionStyle
} from "./MotionStyle";

export interface SoullinkRuntimeOptions {
  profile: ModelProfile;
  personality?: Partial<CharacterPersonality>;
  emotionPersonality?: EmotionPersonality;
  motionStyle?: MotionStyleOptions;
  audioLevelAnalyzer?: AudioLevelAnalyzer | null;
}

export interface TriggerIntentOptions {
  seed?: number;
  vadTarget?: Partial<VADVector>;
  vadDelta?: Partial<VADVector>;
  actionPlan?: SoullinkActionBeat[];
  parameterPlan?: SoullinkParameterBeat[];
  replyDraft?: string;
  provider?: string;
}

export interface RuntimeSnapshot {
  state: CharacterState;
  emotionIntent: EmotionIntent | null;
  runtimeExpression: RuntimeExpression | null;
  seed: number | null;
  vad: VADRuntimeState;
  actionUnits: FACSActionUnitState;
  facs: FACSLikeState;
  live2dParams: Live2DParamState;
  nativeAnimation: NativeAnimationDirective | null;
  profile: ModelProfile;
  idleEnabled: boolean;
  lipSyncEnabled: boolean;
  manualFACS: PartialFACSLikeState;
  manualActionUnits: PartialFACSActionUnitState;
  parameterGain: number;
  bodyMotionGain: number;
  proactiveRepeatEnabled: boolean;
  motionStyle: ResolvedMotionStyle;
  plan: SoullinkPlanRuntimeState | null;
  proactive: SoullinkProactiveEvent | null;
  reflection: SoullinkReflectionState | null;
  customChannels: Record<string, number>;
}

export class SoullinkRuntime {
  private stateMachine = new CharacterStateMachine();
  private classifier = new MessageReactionClassifier();
  private generator = new RuntimeExpressionGenerator();
  private emotionState: EmotionStateController;
  private vadMapper = new VADExpressionMapper();
  private vadGesture: VADGestureController;
  private vadMicroMotion: VADMicroMotionController;
  private vadPrivateParameters = new VADPrivateParameterOverlay();
  private vadPrivateParameterInfo: Record<string, VADPrivateParameterInfo> = {};
  private actionUnitSolver = new ActionUnitSolver();
  private idle: IdleEngine;
  private idleActions: IdleActionScheduler;
  private mixer = new MotionMixer();
  private paramSmoother = new LayeredParameterMixer();
  private lipSync = new LipSyncController();
  private voiceWaitingMotion = new VoiceWaitingMotionController();
  private reaction = new ReactionSequencer();
  private actionPlan = new ActionPlanSequencer();
  private speechParameters = new ParameterPlanSequencer();
  private recovery = new RecoveryController();
  private proactive = new ProactiveController();
  private reflectionPulse = new ReflectionPulseController();
  private adapter: ModelProfileAdapter;
  private profile: ModelProfile;
  private personality: CharacterPersonality;
  private motionStyle: ResolvedMotionStyle;
  private sessionRandom: RandomSource;
  private audioLevelAnalyzer: AudioLevelAnalyzer | null;
  private currentIntent: EmotionIntent | null = null;
  private currentSeed: number | null = null;
  private currentVAD: VADRuntimeState = {
    current: { valence: 0, arousal: 0, dominance: 0 },
    target: { valence: 0, arousal: 0, dominance: 0 },
    dominantEmotion: "neutral",
    intensity: 0
  };
  private currentActionUnits: FACSActionUnitState = createDefaultActionUnitState();
  private currentFACS: FACSLikeState = createDefaultFACSState();
  private currentParams: Live2DParamState = {};
  private currentNativeAnimation: NativeAnimationDirective | null = null;
  private manualFACS: PartialFACSLikeState = {};
  private manualActionUnits: PartialFACSActionUnitState = {};
  private customChannels: Record<string, number> = {};
  private vadExpressionResidue: VADExpressionResidue | null = null;
  private parameterGain = 1.45;
  private bodyMotionGain = 1.25;
  private idleEnabled = true;
  private lipSyncEnabled = true;
  private voicePlaybackActive = false;
  private currentPlan: SoullinkPlanRuntimeState | null = null;
  private currentProactive: SoullinkProactiveEvent | null = null;
  private currentReflection: SoullinkReflectionState | null = null;
  private listenDuration = 0.46;
  private speechDuration = 2.2;

  constructor(options: SoullinkRuntimeOptions) {
    this.profile = options.profile;
    this.adapter = new ModelProfileAdapter(options.profile);
    this.emotionState = new EmotionStateController(options.emotionPersonality);
    this.currentVAD = this.emotionState.update(0);
    this.personality = {
      expressiveness: 0.88,
      softness: 0.7,
      shyness: 0.58,
      gazeStability: 0.72,
      ...options.personality
    };
    this.motionStyle = resolveMotionStyle(options.motionStyle, this.personality.gazeStability);
    this.sessionRandom = seededRandom(deriveMotionSeed(this.motionStyle.seed, 0));
    this.audioLevelAnalyzer = options.audioLevelAnalyzer ?? null;
    this.idle = this.createIdleEngine();
    this.idleActions = this.createIdleActionScheduler();
    this.vadGesture = new VADGestureController(deriveMotionSeed(this.motionStyle.seed, 20));
    this.vadMicroMotion = new VADMicroMotionController(deriveMotionSeed(this.motionStyle.seed, 21));
  }

  setProfile(profile: ModelProfile) {
    this.profile = profile;
    this.adapter.setProfile(profile);
    this.refreshPrivateVADParameters();
  }

  setIdleEnabled(enabled: boolean) {
    this.idleEnabled = enabled;
  }

  setLipSyncEnabled(enabled: boolean) {
    this.lipSyncEnabled = enabled;
  }

  setMotionStyle(options: MotionStyleOptions) {
    this.motionStyle = resolveMotionStyle(
      { ...this.motionStyle, ...options },
      this.personality.gazeStability,
      this.motionStyle.seed
    );
    this.sessionRandom = seededRandom(deriveMotionSeed(this.motionStyle.seed, 0));
    this.idle = this.createIdleEngine();
    this.idleActions = this.createIdleActionScheduler();
    this.vadGesture = new VADGestureController(deriveMotionSeed(this.motionStyle.seed, 20));
    this.vadMicroMotion = new VADMicroMotionController(deriveMotionSeed(this.motionStyle.seed, 21));
  }

  getMotionStyle(): ResolvedMotionStyle {
    return { ...this.motionStyle };
  }

  setAudioLevelAnalyzer(analyzer: AudioLevelAnalyzer | null) {
    this.audioLevelAnalyzer?.reset?.();
    this.audioLevelAnalyzer = analyzer;
    this.lipSync.reset();
  }

  setVoicePlaybackActive(active: boolean) {
    if (this.voicePlaybackActive !== active) this.lipSync.reset();
    this.voicePlaybackActive = active;
    if (active) this.voiceWaitingMotion.reset();
    else this.audioLevelAnalyzer?.reset?.();
  }

  startVoiceWaitingMotion(timeSeconds: number, seed?: number, options?: VoiceWaitingMotionOptions) {
    return this.voiceWaitingMotion.start(timeSeconds, seed, options);
  }

  clearVoiceWaitingMotion() {
    this.voiceWaitingMotion.reset();
  }

  setManualFACS(facs: PartialFACSLikeState) {
    this.manualFACS = { ...facs };
  }

  setManualActionUnits(actionUnits: PartialFACSActionUnitState) {
    this.manualActionUnits = { ...actionUnits };
  }

  setCustomChannel(name: string, value: number) {
    this.customChannels[name] = value;
  }

  setCustomChannels(record: Record<string, number>) {
    this.customChannels = { ...record };
  }

  clearCustomChannels() {
    this.customChannels = {};
  }

  setParameterGain(gain: number) {
    this.parameterGain = clamp(gain, 0.4, 5);
  }

  setBodyMotionGain(gain: number) {
    this.bodyMotionGain = clamp(gain, 0, 4);
  }

  setPrivateVADParameters(parameters: Record<string, VADPrivateParameterInfo>) {
    this.vadPrivateParameterInfo = { ...parameters };
    this.refreshPrivateVADParameters();
    return this.vadPrivateParameters.getSummary();
  }

  private refreshPrivateVADParameters() {
    const mappedIds = new Set<string>();
    for (const rule of Object.values(this.profile.parameterMap)) {
      if (rule?.target) mappedIds.add(rule.target);
      for (const target of rule?.targets ?? []) mappedIds.add(target);
    }
    this.vadPrivateParameters.setParameters(
      this.vadPrivateParameterInfo,
      this.profile.privateEmotionMap,
      mappedIds
    );
  }

  setVADDecayRate(rate: number) {
    this.emotionState.configure({ decayRate: rate });
  }

  setProactiveRepeatEnabled(enabled: boolean) {
    this.proactive.setRepeatOnSettledVAD(enabled);
  }

  clearManualFACS() {
    this.manualFACS = {};
    this.manualActionUnits = {};
  }

  sendMessage(message: string, timeSeconds: number): EmotionIntent {
    const intent = this.classifier.classify(message);
    this.triggerIntent(intent, timeSeconds);
    return intent;
  }

  triggerPlan(plan: SoullinkExternalPlan, timeSeconds: number): EmotionIntent {
    this.triggerIntent(plan.intent, timeSeconds, {
      vadTarget: plan.vadTarget,
      vadDelta: plan.vadDelta,
      actionPlan: plan.actionPlan,
      parameterPlan: plan.parameterPlan,
      replyDraft: plan.replyDraft,
      provider: plan.provider
    });

    return plan.intent;
  }

  triggerIntent(intent: EmotionIntent, timeSeconds: number, options: TriggerIntentOptions | number = {}) {
    const resolvedOptions: TriggerIntentOptions = typeof options === "number" ? { seed: options } : options;
    const seed = resolvedOptions.seed ?? Math.max(1, Math.floor(this.sessionRandom() * 0x7fffffff));
    const reactionStart = timeSeconds;

    if (!intent.contextTags.includes("proactive_idle")) {
      this.proactive.notifyUserInteraction(timeSeconds);
    }
    this.currentProactive = null;
    this.reflectionPulse.reset();
    this.currentIntent = intent;
    this.currentSeed = seed;
    const expression = this.generator.generate({
      emotion: intent.emotion,
      variant: intent.variant,
      intensity: intent.intensity,
      contextTags: intent.contextTags,
      personality: this.personality,
      previousState: this.currentFACS,
      seed
    });

    this.reaction.start(expression, reactionStart);
    this.vadExpressionResidue = this.createVADExpressionResidue(expression, intent);
    this.actionPlan.start(resolvedOptions.actionPlan, reactionStart);
    this.speechParameters.reset();
    this.emotionState.nudge(intent);
    if (resolvedOptions.vadDelta) this.emotionState.nudgeVAD(resolvedOptions.vadDelta, 0.72);
    if (resolvedOptions.vadTarget) this.emotionState.blendTo(resolvedOptions.vadTarget, 0.68);
    this.idle.deferBlink(timeSeconds, this.listenDuration + this.reaction.duration + 0.35);
    this.recovery.reset();
    this.speechDuration = estimateMockSpeechDuration(intent.sourceMessage ?? intent.emotion);
    this.currentNativeAnimation = resolveNativeAnimation(this.profile, intent);
    this.currentPlan = {
      provider: resolvedOptions.provider ?? "local",
      replyDraft: resolvedOptions.replyDraft ?? "",
      actionBeatCount: this.actionPlan.beatCount,
      parameterBeatCount: this.speechParameters.beatCount,
      startedAt: timeSeconds
    };
    this.stateMachine.transition("LISTENING", timeSeconds);
  }

  startSpeechMotion(
    parameterPlan: SoullinkParameterBeat[] | undefined,
    timeSeconds: number,
    durationSeconds?: number
  ) {
    if (durationSeconds !== undefined) {
      this.speechDuration = clamp(durationSeconds, 0.4, 120);
    }

    this.speechParameters.start(parameterPlan, timeSeconds);
    if (this.currentPlan) {
      this.currentPlan = {
        ...this.currentPlan,
        parameterBeatCount: this.speechParameters.beatCount
      };
    }
    this.stateMachine.transition("SPEAKING", timeSeconds, true);
  }

  clearSpeechMotion() {
    this.speechParameters.reset();
  }

  applyVADTarget(target: Partial<VADVector>, amount = 0.65) {
    this.emotionState.blendTo(target, amount);
  }

  applyVADDelta(delta: Partial<VADVector>, amount = 1) {
    this.emotionState.nudgeVAD(delta, amount);
  }

  setReflection(reflection: Omit<SoullinkReflectionState, "createdAt">, timeSeconds: number) {
    const pulseIntensity = this.getReflectionPulseIntensity(reflection.vadTarget);

    this.currentReflection = {
      ...reflection,
      createdAt: timeSeconds
    };

    if (reflection.vadTarget) {
      this.emotionState.blendTo(reflection.vadTarget, 0.94);
    }

    if (this.stateMachine.current === "IDLE" || this.stateMachine.current === "RECOVERING") {
      this.reflectionPulse.start({
        emotion: reflection.emotion,
        vadTarget: reflection.vadTarget,
        intensity: pulseIntensity,
        seed: Math.round(timeSeconds * 1000)
      }, timeSeconds);
    }
  }

  consumeProactive() {
    this.proactive.consume();
    this.currentProactive = null;
  }

  reset(timeSeconds: number) {
    this.currentIntent = null;
    this.currentSeed = null;
    this.emotionState.reset();
    this.currentVAD = this.emotionState.update(0);
    this.currentActionUnits = createDefaultActionUnitState();
    this.currentFACS = createDefaultFACSState();
    this.currentParams = {};
    this.currentNativeAnimation = null;
    this.voicePlaybackActive = false;
    this.audioLevelAnalyzer?.reset?.();
    this.lipSync.reset();
    this.manualFACS = {};
    this.manualActionUnits = {};
    this.customChannels = {};
    this.reaction.reset();
    this.actionPlan.reset();
    this.speechParameters.reset();
    this.voiceWaitingMotion.reset();
    this.recovery.reset();
    this.vadGesture.reset();
    this.vadMicroMotion.reset();
    this.idle.reset();
    this.idleActions.reset(timeSeconds);
    this.reflectionPulse.reset();
    this.vadExpressionResidue = null;
    this.proactive.reset(timeSeconds);
    this.currentPlan = null;
    this.currentProactive = null;
    this.currentReflection = null;
    this.paramSmoother.reset();
    this.sessionRandom = seededRandom(deriveMotionSeed(this.motionStyle.seed, 0));
    this.stateMachine.reset(timeSeconds);
  }

  update(timeSeconds: number, deltaSeconds: number): RuntimeSnapshot {
    this.advanceState(timeSeconds);

    const focusLevel = this.stateMachine.current === "IDLE" || this.stateMachine.current === "RECOVERING" ? 0 : 1;
    this.currentVAD = this.emotionState.update(deltaSeconds);
    this.currentProactive = this.proactive.update(timeSeconds, this.stateMachine.current, this.currentVAD);
    const emotionLayer = this.vadMapper.toFACS(this.currentVAD.current, this.getEmotionLayerWeight(), {
      dominantEmotion: this.currentVAD.dominantEmotion,
      residue: this.vadExpressionResidue
    });
    const idleBaseLayer = this.idle.update(timeSeconds, {
        enabled: this.idleEnabled,
        focusLevel,
        profile: this.profile,
        bodyMotionGain: this.bodyMotionGain
    });
    const vadMicroLayer = this.vadMicroMotion.update(timeSeconds, this.currentVAD.current, focusLevel, this.bodyMotionGain);
    const idleActionLayer = this.idleActions.update(timeSeconds, {
      enabled: this.idleEnabled,
      focusLevel,
      vad: this.currentVAD,
      personality: this.personality,
      profile: this.profile,
      suppressed: !this.isIdleGestureEnabled()
    });
    const vadGestureLayer = this.vadGesture.update(timeSeconds, this.currentVAD, {
      enabled: this.isIdleGestureEnabled(),
      bodyMotionGain: this.bodyMotionGain,
      frequency: this.motionStyle.gestureFrequency,
      avoidRepeatWindow: this.motionStyle.avoidRepeatWindow
    });
    const idleLayer = addFACS(addFACS(addFACS(idleBaseLayer, vadMicroLayer), idleActionLayer), vadGestureLayer);
    const reactionLayer = this.getReactionLayer(timeSeconds);
    const reflectionLayer = this.getReflectionLayer(timeSeconds);
    const voiceWaitingLayer = this.voiceWaitingMotion.update(timeSeconds, this.bodyMotionGain);
    const audioInput = this.readAudioInput();
    const speechLayer = this.lipSync.update(timeSeconds, {
      enabled: this.lipSyncEnabled,
      speaking: this.voicePlaybackActive,
      intensity: this.currentIntent?.intensity ?? 0,
      deltaSeconds,
      speechAccentGain: this.motionStyle.speechAccentGain,
      ...audioInput
    });
    const manualLayer = this.getManualLayer();

    this.currentFACS = this.applyLipSyncMouthGate(this.mixer.mix({
      idle: idleLayer,
      emotion: emotionLayer,
      reaction: addFACS(addFACS(reactionLayer, reflectionLayer), voiceWaitingLayer),
      speech: speechLayer,
      manual: manualLayer
    }), speechLayer);
    this.currentActionUnits = this.actionUnitSolver.project(this.currentFACS) as FACSActionUnitState;

    const facsParams = this.applyParameterGain(this.adapter.apply(this.currentFACS, this.customChannels));
    const privateVADParams = this.vadPrivateParameters.update(
      this.currentVAD,
      this.getPrivateVADParameterWeight(),
      {
        intentEmotion: this.currentIntent?.naturalEmotion ?? this.currentIntent?.emotion,
        intentVariant: this.currentIntent?.naturalVariant ?? this.currentIntent?.variant
      }
    );
    const targetParams = this.applySpeechParameterOverlay({
      ...facsParams,
      ...privateVADParams
    }, timeSeconds);
    this.currentParams = this.paramSmoother.smooth(
      targetParams,
      deltaSeconds,
      this.profile.parameterSmoothing ?? {}
    );

    return this.getSnapshot();
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      state: this.stateMachine.current,
      emotionIntent: this.currentIntent,
      runtimeExpression: this.reaction.currentExpression,
      seed: this.currentSeed,
      vad: this.currentVAD,
      actionUnits: this.currentActionUnits,
      facs: this.currentFACS,
      live2dParams: this.currentParams,
      nativeAnimation: this.currentNativeAnimation,
      profile: this.profile,
      idleEnabled: this.idleEnabled,
      lipSyncEnabled: this.lipSyncEnabled,
      manualFACS: this.manualFACS,
      manualActionUnits: this.manualActionUnits,
      parameterGain: this.parameterGain,
      bodyMotionGain: this.bodyMotionGain,
      proactiveRepeatEnabled: this.proactive.repeatEnabled,
      motionStyle: { ...this.motionStyle },
      plan: this.currentPlan,
      proactive: this.currentProactive,
      reflection: this.currentReflection,
      customChannels: { ...this.customChannels }
    };
  }

  private getEmotionLayerWeight(): number {
    const state = this.stateMachine.current;
    if (state === "IDLE" || state === "RECOVERING") return 1;
    if (state === "SPEAKING") return 0.42;
    return 0.24;
  }

  private createIdleEngine(): IdleEngine {
    return new IdleEngine({
      seed: deriveMotionSeed(this.motionStyle.seed, 10),
      gazeStability: this.motionStyle.gazeStability,
      blinkRate: this.motionStyle.blinkRate,
      breathRate: this.motionStyle.breathRate,
      breathVariance: this.motionStyle.breathVariance,
      microMotionGain: this.motionStyle.microMotionGain
    });
  }

  private createIdleActionScheduler(): IdleActionScheduler {
    return new IdleActionScheduler({
      seed: deriveMotionSeed(this.motionStyle.seed, 11),
      spontaneity: this.motionStyle.spontaneity / 2,
      gain: this.motionStyle.idleActionGain,
      recentWindowSize: this.motionStyle.avoidRepeatWindow
    });
  }

  private readAudioInput(): { audioLevel?: number; audioPeak?: number } {
    if (!this.voicePlaybackActive) return {};

    const analyzer = this.audioLevelAnalyzer;
    if (!analyzer) return {};

    try {
      const available = analyzer.isAvailable?.() ?? analyzer.available?.() ?? true;
      if (!available) return {};

      const level = analyzer.getLevel();
      if (!Number.isFinite(level) || level < 0) return {};

      const peak = analyzer.getPeak?.();
      return {
        audioLevel: clamp(level, 0, 1),
        audioPeak: peak !== undefined && Number.isFinite(peak) && peak >= 0
          ? clamp(peak, 0, 1)
          : undefined
      };
    } catch {
      return {};
    }
  }

  private getPrivateVADParameterWeight(): number {
    const state = this.stateMachine.current;
    if (state === "IDLE" || state === "RECOVERING") return 1;
    if (state === "SPEAKING") return 0.46;
    return 0.72;
  }

  private isIdleGestureEnabled(): boolean {
    return !this.voicePlaybackActive && (this.stateMachine.current === "IDLE" || this.stateMachine.current === "RECOVERING");
  }

  private getManualLayer(): PartialFACSLikeState {
    if (Object.keys(this.manualActionUnits).length === 0) return this.manualFACS;
    return addFACS(this.manualFACS, this.actionUnitSolver.solvePartial(this.manualActionUnits));
  }

  private applyParameterGain(params: Live2DParamState): Live2DParamState {
    if (this.parameterGain === 1) return params;

    const ranges = this.getParameterRanges();
    const result: Live2DParamState = {};

    for (const [key, value] of Object.entries(params)) {
      const neutral = (this.profile.neutralParams ?? deriveNeutralParams(this.profile))[key] ?? 0;
      const boosted = neutral + (value - neutral) * this.parameterGain;
      const range = ranges[key];
      result[key] = range ? clamp(boosted, range.min, range.max) : boosted;
    }

    return result;
  }

  private getParameterRanges(): Record<string, { min?: number; max?: number }> {
    return deriveParameterRanges(this.profile);
  }

  private advanceState(timeSeconds: number) {
    const state = this.stateMachine.current;

    if (state === "LISTENING" && this.stateMachine.elapsed(timeSeconds) >= this.listenDuration) {
      this.stateMachine.transition("REACTING", timeSeconds);
      return;
    }

    if (state === "REACTING" && this.reaction.isComplete(timeSeconds) && this.actionPlan.isComplete(timeSeconds)) {
      this.stateMachine.transition("SPEAKING", timeSeconds);
      return;
    }

    if (state === "SPEAKING" && this.stateMachine.elapsed(timeSeconds) >= this.speechDuration) {
      const expression = this.reaction.currentExpression;

      if (expression?.idleBias) {
        const idleReturnDuration = Math.max(3.4, Math.min(7.2, expression.recoveryDuration));
        this.idle.setBias(expression.idleBias, idleReturnDuration, timeSeconds);
      }

      this.recovery.reset();
      this.reaction.reset();
      this.actionPlan.reset();
      this.speechParameters.reset();
      this.stateMachine.transition("IDLE", timeSeconds);
      return;
    }

    if (state === "RECOVERING" && this.recovery.isComplete(timeSeconds)) {
      this.recovery.reset();
      this.reaction.reset();
      this.actionPlan.reset();
      this.speechParameters.reset();
      this.stateMachine.transition("IDLE", timeSeconds);
    }
  }

  private getReactionLayer(timeSeconds: number): PartialFACSLikeState {
    const state = this.stateMachine.current;

    if (state === "LISTENING") {
      return addFACS(this.reaction.evaluate(timeSeconds), this.actionPlan.evaluate(timeSeconds));
    }

    if (state === "REACTING") {
      return addFACS(this.reaction.evaluate(timeSeconds), this.actionPlan.evaluate(timeSeconds));
    }

    if (state === "SPEAKING") {
      return this.reaction.hold(0.82);
    }

    if (state === "RECOVERING") {
      return {};
    }

    return {};
  }

  private applySpeechParameterOverlay(base: Live2DParamState, timeSeconds: number): Live2DParamState {
    if (this.stateMachine.current !== "SPEAKING") return base;
    const overlay = this.speechParameters.evaluate(timeSeconds);
    return Object.keys(overlay).length ? { ...base, ...overlay } : base;
  }

  private applyLipSyncMouthGate(facs: FACSLikeState, speechLayer: PartialFACSLikeState): FACSLikeState {
    return {
      ...facs,
      mouthOpen: this.voicePlaybackActive && this.lipSyncEnabled ? speechLayer.mouthOpen ?? 0 : 0
    };
  }

  private getReflectionLayer(timeSeconds: number): PartialFACSLikeState {
    const state = this.stateMachine.current;
    if (state !== "IDLE" && state !== "RECOVERING") return {};

    return this.reflectionPulse.update(timeSeconds);
  }

  private getReflectionPulseIntensity(vadTarget?: Partial<VADVector>): number {
    if (!vadTarget) return 0.58;

    const magnitude = (
      Math.abs(vadTarget.valence ?? 0)
      + Math.abs(vadTarget.arousal ?? 0) * 0.82
      + Math.abs(vadTarget.dominance ?? 0) * 0.64
    ) / 2.46;

    return clamp(0.62 + magnitude * 0.76, 0.68, 0.98);
  }

  private createVADExpressionResidue(expression: RuntimeExpression, intent: EmotionIntent): VADExpressionResidue {
    return {
      emotion: this.getNaturalEmotionName(expression, intent),
      facs: clampFACSState({
        ...scaleFACSFromNeutral(expression.peakFACS, 0.18),
        ...(expression.idleBias ?? {})
      })
    };
  }

  private getNaturalEmotionName(expression: RuntimeExpression, intent: EmotionIntent): string {
    if (intent.naturalVariant?.includes("shy") || expression.variant.includes("shy")) return "shy";
    return intent.naturalEmotion ?? expression.emotion;
  }
}
