import { clampFACSState } from "../facs/FACSUtils";
import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";
import type { VADRuntimeState, VADVector } from "../emotion/VADState";
import type { CharacterPersonality } from "../expression/RuntimeExpressionGenerator";
import { detectCapabilities } from "../profile/CapabilityDetector";
import type { ModelCapabilities, ModelProfile } from "../profile/ModelProfile";
import { clamp } from "../utils/clamp";
import { seededRandom, type RandomSource } from "../utils/seededRandom";

export type IdleActionLabel =
  | "small-nod"
  | "head-tilt"
  | "side-look"
  | "weight-shift"
  | "gentle-lean"
  | "sigh-sink"
  | "slow-blink";

export type IdleActionDirection = -1 | 0 | 1;

export interface IdleActionSchedulerOptions {
  seed: number;
  spontaneity?: number;
  gain?: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
  recentWindowSize?: number;
}

export interface IdleActionUpdateContext {
  enabled: boolean;
  focusLevel: number;
  vad: VADVector | VADRuntimeState;
  personality?: Partial<CharacterPersonality>;
  profile: ModelProfile;
  suppressed?: boolean;
}

export interface IdleActionSchedulerState {
  activeAction: IdleActionLabel | null;
  direction: IdleActionDirection;
  startedAt: number | null;
  duration: number;
  nextActionAt: number | null;
  recentActions: IdleActionLabel[];
  recentDirections: Array<-1 | 1>;
  suppressed: boolean;
}

interface PoseKeyframe {
  progress: number;
  pose: PartialFACSLikeState;
}

interface ActiveIdleAction {
  label: IdleActionLabel;
  direction: IdleActionDirection;
  startedAt: number;
  duration: number;
  keyframes: PoseKeyframe[];
}

interface ResolvedPersonality {
  expressiveness: number;
  softness: number;
  shyness: number;
  gazeStability: number;
}

interface ActionTemplate {
  label: IdleActionLabel;
  duration: [number, number];
  directional: boolean;
  isAvailable: (capabilities: ModelCapabilities) => boolean;
}

const defaultPersonality: ResolvedPersonality = {
  expressiveness: 0.85,
  softness: 0.65,
  shyness: 0.55,
  gazeStability: 0.7
};

const actionTemplates: ActionTemplate[] = [
  {
    label: "small-nod",
    duration: [0.82, 1.2],
    directional: false,
    isAvailable: (capabilities) => capabilities.headControl || capabilities.bodyControl
  },
  {
    label: "head-tilt",
    duration: [1.35, 2.15],
    directional: true,
    isAvailable: (capabilities) => capabilities.headControl || capabilities.gazeControl
  },
  {
    label: "side-look",
    duration: [1.45, 2.35],
    directional: true,
    isAvailable: (capabilities) => capabilities.gazeControl || capabilities.headControl
  },
  {
    label: "weight-shift",
    duration: [1.65, 2.65],
    directional: true,
    isAvailable: (capabilities) => capabilities.bodyControl || capabilities.headControl
  },
  {
    label: "gentle-lean",
    duration: [1.25, 2.05],
    directional: true,
    isAvailable: (capabilities) => capabilities.bodyControl || capabilities.headControl
  },
  {
    label: "sigh-sink",
    duration: [1.7, 2.8],
    directional: false,
    isAvailable: (capabilities) => capabilities.bodyControl
      || capabilities.headControl
      || capabilities.gazeControl
      || capabilities.browControl
      || capabilities.eyeBlink
  },
  {
    label: "slow-blink",
    duration: [0.72, 1.08],
    directional: true,
    isAvailable: (capabilities) => capabilities.eyeBlink
  }
];

export class IdleActionScheduler {
  private readonly seed: number;
  private readonly spontaneity: number;
  private readonly gain: number;
  private readonly minIntervalSeconds: number;
  private readonly maxIntervalSeconds: number;
  private readonly recentWindowSize: number;
  private random: RandomSource;
  private active: ActiveIdleAction | null = null;
  private nextActionAt: number | null = null;
  private recentActions: IdleActionLabel[] = [];
  private recentDirections: Array<-1 | 1> = [];
  private lastUpdateAt = 0;
  private suppressed = false;

  constructor(options: IdleActionSchedulerOptions) {
    this.seed = finiteOr(options.seed, 1);
    this.spontaneity = clamp(finiteOr(options.spontaneity, 0.68), 0, 1);
    this.gain = clamp(finiteOr(options.gain, 1), 0, 2.5);
    this.minIntervalSeconds = clamp(finiteOr(options.minIntervalSeconds, 4.8), 0.25, 120);
    this.maxIntervalSeconds = clamp(
      finiteOr(options.maxIntervalSeconds, 11.5),
      this.minIntervalSeconds,
      180
    );
    this.recentWindowSize = Math.floor(clamp(finiteOr(options.recentWindowSize, 3), 0, 6));
    this.random = seededRandom(this.seed);
  }

  update(timeSeconds: number, context: IdleActionUpdateContext): PartialFACSLikeState {
    const time = Math.max(0, finiteOr(timeSeconds, this.lastUpdateAt));
    if (time < this.lastUpdateAt) this.reset(time);
    this.lastUpdateAt = time;

    if (!context.enabled || context.suppressed || this.spontaneity <= 0 || this.gain <= 0) {
      this.active = null;
      this.nextActionAt = null;
      this.suppressed = true;
      return {};
    }

    const focusLevel = clamp(finiteOr(context.focusLevel, 0), 0, 1);
    if (this.suppressed || this.nextActionAt === null) {
      this.suppressed = false;
      this.nextActionAt = time + this.sampleInterval(focusLevel);
      return {};
    }

    if (this.active) {
      const elapsed = time - this.active.startedAt;
      if (elapsed < this.active.duration) return evaluateAction(this.active, elapsed);
      this.active = null;
    }

    if (time < this.nextActionAt) return {};

    const action = this.createAction(time, context, focusLevel);
    if (!action) {
      this.nextActionAt = time + this.sampleInterval(focusLevel);
      return {};
    }

    this.active = action;
    this.remember(action.label, action.direction);
    this.nextActionAt = time + action.duration + this.sampleInterval(focusLevel);
    return evaluateAction(action, 0);
  }

  interrupt(timeSeconds = this.lastUpdateAt) {
    const time = Math.max(0, finiteOr(timeSeconds, this.lastUpdateAt));
    this.active = null;
    this.lastUpdateAt = time;
    this.nextActionAt = time + this.sampleInterval(0);
  }

  reset(timeSeconds = 0) {
    this.random = seededRandom(this.seed);
    this.active = null;
    this.nextActionAt = null;
    this.recentActions = [];
    this.recentDirections = [];
    this.lastUpdateAt = Math.max(0, finiteOr(timeSeconds, 0));
    this.suppressed = false;
  }

  getState(): IdleActionSchedulerState {
    return {
      activeAction: this.active?.label ?? null,
      direction: this.active?.direction ?? 0,
      startedAt: this.active?.startedAt ?? null,
      duration: this.active?.duration ?? 0,
      nextActionAt: this.nextActionAt,
      recentActions: [...this.recentActions],
      recentDirections: [...this.recentDirections],
      suppressed: this.suppressed
    };
  }

  private createAction(
    timeSeconds: number,
    context: IdleActionUpdateContext,
    focusLevel: number
  ): ActiveIdleAction | null {
    const capabilities = context.profile.capabilities
      ?? withConservativeFallback(detectCapabilities(context.profile));
    const vad = resolveVAD(context.vad);
    const personality = resolvePersonality(context.personality);
    const available = actionTemplates.filter((template) => template.isAvailable(capabilities));
    if (available.length === 0) return null;

    const unrepeated = this.recentWindowSize > 0
      ? available.filter((template) => !this.recentActions.includes(template.label))
      : available;
    const candidates = unrepeated.length > 0
      ? unrepeated
      : available.filter((template) => template.label !== this.recentActions.at(-1));
    const pool = candidates.length > 0 ? candidates : available;
    const template = weightedPick(
      pool,
      (candidate) => actionWeight(candidate.label, vad, personality, focusLevel),
      this.random
    );
    const direction = template.directional ? this.pickDirection() : 0;
    const duration = template.duration[0]
      + (template.duration[1] - template.duration[0]) * this.random();
    const vadIntensity = (
      Math.abs(vad.valence)
      + Math.abs(vad.arousal) * 0.82
      + Math.abs(vad.dominance) * 0.64
    ) / 2.46;
    const amplitude = clamp(
      this.gain
      * (0.72 + personality.expressiveness * 0.4)
      * (1 - focusLevel * 0.38)
      * (0.9 + this.spontaneity * 0.14)
      * (0.9 + vadIntensity * 0.18)
      * (0.86 + this.random() * 0.28),
      0,
      2.2
    );

    return {
      label: template.label,
      direction,
      startedAt: timeSeconds,
      duration,
      keyframes: buildKeyframes(template.label, direction, amplitude, capabilities)
    };
  }

  private pickDirection(): -1 | 1 {
    let direction: -1 | 1 = this.random() < 0.5 ? -1 : 1;
    const lastDirection = this.recentDirections.at(-1);
    if (this.recentWindowSize > 0 && direction === lastDirection) direction = direction === -1 ? 1 : -1;
    return direction;
  }

  private remember(label: IdleActionLabel, direction: IdleActionDirection) {
    if (this.recentWindowSize <= 0) return;

    this.recentActions.push(label);
    if (this.recentActions.length > this.recentWindowSize) this.recentActions.shift();

    if (direction !== 0) {
      this.recentDirections.push(direction);
      if (this.recentDirections.length > this.recentWindowSize) this.recentDirections.shift();
    }
  }

  private sampleInterval(focusLevel: number): number {
    const curve = clamp(0.68 + this.spontaneity * 1.7 - focusLevel * 0.32, 0.42, 2.38);
    const randomPosition = Math.pow(this.random(), curve);
    const focusAdjusted = randomPosition + (1 - randomPosition) * focusLevel * 0.34;
    return this.minIntervalSeconds
      + (this.maxIntervalSeconds - this.minIntervalSeconds) * focusAdjusted;
  }
}

function resolveVAD(input: VADVector | VADRuntimeState): VADVector {
  const source = "current" in input ? input.current : input;
  return {
    valence: clamp(finiteOr(source.valence, 0), -1, 1),
    arousal: clamp(finiteOr(source.arousal, 0), -1, 1),
    dominance: clamp(finiteOr(source.dominance, 0), -1, 1)
  };
}

function resolvePersonality(input?: Partial<CharacterPersonality>): ResolvedPersonality {
  return {
    expressiveness: clamp(finiteOr(input?.expressiveness, defaultPersonality.expressiveness), 0, 1),
    softness: clamp(finiteOr(input?.softness, defaultPersonality.softness), 0, 1),
    shyness: clamp(finiteOr(input?.shyness, defaultPersonality.shyness), 0, 1),
    gazeStability: clamp(finiteOr(input?.gazeStability, defaultPersonality.gazeStability), 0, 1)
  };
}

function actionWeight(
  label: IdleActionLabel,
  vad: VADVector,
  personality: ResolvedPersonality,
  focusLevel: number
): number {
  const positive = Math.max(0, vad.valence);
  const negative = Math.max(0, -vad.valence);
  const aroused = Math.max(0, vad.arousal);
  const calm = Math.max(0, -vad.arousal);
  const dominant = Math.max(0, vad.dominance);
  const submissive = Math.max(0, -vad.dominance);

  if (label === "small-nod") {
    return 1.05 + positive * 0.42 + aroused * 0.4 + focusLevel * 0.42
      + personality.expressiveness * 0.28;
  }
  if (label === "head-tilt") {
    return 0.92 + positive * 0.18 + submissive * 0.24 + personality.softness * 0.34
      + personality.shyness * 0.16;
  }
  if (label === "side-look") {
    return 0.62 + negative * 0.28 + submissive * 0.36 + personality.shyness * 0.56
      + (1 - personality.gazeStability) * 0.6;
  }
  if (label === "weight-shift") {
    return 0.86 + aroused * 0.24 + dominant * 0.34 + personality.expressiveness * 0.34;
  }
  if (label === "gentle-lean") {
    return 0.76 + positive * 0.34 + dominant * 0.28 + focusLevel * 0.18
      + personality.expressiveness * 0.32 - personality.shyness * 0.12;
  }
  if (label === "sigh-sink") {
    return 0.48 + negative * 0.62 + calm * 0.52 + personality.softness * 0.32;
  }

  return 0.72 + calm * 0.56 + personality.softness * 0.38 + focusLevel * 0.12;
}

function weightedPick(
  templates: ActionTemplate[],
  getWeight: (template: ActionTemplate) => number,
  random: RandomSource
): ActionTemplate {
  const weights = templates.map((template) => Math.max(0.001, getWeight(template)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;

  for (let index = 0; index < templates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return templates[index];
  }

  return templates[templates.length - 1];
}

function buildKeyframes(
  label: IdleActionLabel,
  direction: IdleActionDirection,
  amplitude: number,
  capabilities: ModelCapabilities
): PoseKeyframe[] {
  const side = direction === 0 ? 1 : direction;
  let frames: PoseKeyframe[];

  if (label === "small-nod") {
    frames = [
      frame(0, {}),
      frame(0.2, { headY: 0.086, bodyY: 0.018, gazeY: 0.012 }),
      frame(0.42, { headY: -0.026, bodyY: -0.006, gazeY: -0.008 }),
      frame(0.68, { headY: 0.016, bodyY: 0.004 }),
      frame(1, {})
    ];
  } else if (label === "head-tilt") {
    frames = [
      frame(0, {}),
      frame(0.28, {
        headX: side * 0.018,
        headZ: side * 0.094,
        gazeX: -side * 0.038,
        browOuterUp: 0.024
      }),
      frame(0.64, {
        headX: side * 0.014,
        headZ: side * 0.078,
        gazeX: -side * 0.025,
        browOuterUp: 0.016
      }),
      frame(1, {})
    ];
  } else if (label === "side-look") {
    frames = [
      frame(0, {}),
      frame(0.18, { gazeX: side * 0.18, gazeY: 0.018 }),
      frame(0.38, {
        gazeX: side * 0.23,
        gazeY: 0.012,
        headX: side * 0.046,
        headZ: -side * 0.026
      }),
      frame(0.62, {
        gazeX: side * 0.2,
        headX: side * 0.04,
        headZ: -side * 0.022
      }),
      frame(0.8, { gazeX: side * 0.028, headX: side * 0.034, headZ: -side * 0.018 }),
      frame(1, {})
    ];
  } else if (label === "weight-shift") {
    frames = [
      frame(0, {}),
      frame(0.34, {
        bodyX: side * 0.078,
        bodyZ: side * 0.055,
        headX: -side * 0.018,
        headZ: -side * 0.036,
        gazeX: -side * 0.026
      }),
      frame(0.7, {
        bodyX: side * 0.066,
        bodyZ: side * 0.046,
        headX: -side * 0.014,
        headZ: -side * 0.03,
        gazeX: -side * 0.018
      }),
      frame(1, {})
    ];
  } else if (label === "gentle-lean") {
    frames = [
      frame(0, {}),
      frame(0.3, {
        bodyY: side * 0.074,
        headY: side * 0.044,
        gazeY: side * 0.022,
        browOuterUp: side > 0 ? 0.018 : 0
      }),
      frame(0.58, {
        bodyY: side * 0.064,
        headY: side * 0.038,
        gazeY: side * 0.018,
        browOuterUp: side > 0 ? 0.012 : 0
      }),
      frame(0.8, { bodyY: -side * 0.012, headY: -side * 0.008 }),
      frame(1, {})
    ];
  } else if (label === "sigh-sink") {
    frames = [
      frame(0, {}),
      frame(0.2, { browInnerUp: 0.018, eyeBlinkL: 0.08, eyeBlinkR: 0.09 }),
      frame(0.48, {
        headY: -0.064,
        bodyY: -0.054,
        gazeY: -0.048,
        browInnerUp: 0.026,
        eyeBlinkL: 0.2,
        eyeBlinkR: 0.22
      }),
      frame(0.73, {
        headY: -0.048,
        bodyY: -0.042,
        gazeY: -0.034,
        browInnerUp: 0.018,
        eyeBlinkL: 0.06,
        eyeBlinkR: 0.07
      }),
      frame(1, {})
    ];
  } else {
    const leftPeak = side < 0 ? 0.94 : 0.82;
    const rightPeak = side > 0 ? 0.94 : 0.82;
    frames = [
      frame(0, {}),
      frame(0.3, { eyeBlinkL: leftPeak * 0.86, eyeBlinkR: rightPeak * 0.82, headY: -0.01 }),
      frame(0.47, { eyeBlinkL: leftPeak, eyeBlinkR: rightPeak, headY: -0.014 }),
      frame(0.72, { eyeBlinkL: 0.2, eyeBlinkR: 0.18, headY: -0.006 }),
      frame(1, {})
    ];
  }

  return frames.map((keyframe) => ({
    progress: keyframe.progress,
    pose: scaleAndFilterPose(keyframe.pose, amplitude, capabilities)
  }));
}

function frame(progress: number, pose: PartialFACSLikeState): PoseKeyframe {
  return { progress, pose };
}

function scaleAndFilterPose(
  pose: PartialFACSLikeState,
  scale: number,
  capabilities: ModelCapabilities
): PartialFACSLikeState {
  const result: PartialFACSLikeState = {};

  for (const key of Object.keys(pose) as FACSKey[]) {
    const value = pose[key];
    if (typeof value !== "number" || !supportsKey(key, capabilities)) continue;
    result[key] = value * scale;
  }

  return clampFACSState(result);
}

function supportsKey(key: FACSKey, capabilities: ModelCapabilities): boolean {
  if (key === "headX" || key === "headY" || key === "headZ") return capabilities.headControl;
  if (key === "bodyX" || key === "bodyY" || key === "bodyZ") return capabilities.bodyControl;
  if (key === "gazeX" || key === "gazeY") return capabilities.gazeControl;
  if (key === "eyeBlinkL" || key === "eyeBlinkR") return capabilities.eyeBlink;
  if (key === "eyeSmile") return capabilities.eyeSmile;
  if (key === "browInnerUp" || key === "browOuterUp" || key === "browDown") {
    return capabilities.browControl;
  }
  if (key === "mouthOpen" || key === "mouthPucker") return capabilities.mouthOpen;
  if (key === "mouthSmile" || key === "mouthFrown") return capabilities.mouthSmile;
  if (key === "blush") return capabilities.blush;
  if (key === "tear") return capabilities.tear;
  if (key === "sweat") return capabilities.sweat;
  if (key === "breath") return capabilities.breath;
  return true;
}

function evaluateAction(action: ActiveIdleAction, elapsedSeconds: number): PartialFACSLikeState {
  const progress = clamp(elapsedSeconds / action.duration, 0, 1);
  let from = action.keyframes[0];
  let to = action.keyframes[action.keyframes.length - 1];

  for (let index = 1; index < action.keyframes.length; index += 1) {
    const candidate = action.keyframes[index];
    if (progress <= candidate.progress) {
      to = candidate;
      from = action.keyframes[index - 1];
      break;
    }
  }

  const span = to.progress - from.progress;
  const local = span <= 0 ? 1 : clamp((progress - from.progress) / span, 0, 1);
  const eased = local * local * (3 - 2 * local);
  const keys = new Set<FACSKey>([
    ...(Object.keys(from.pose) as FACSKey[]),
    ...(Object.keys(to.pose) as FACSKey[])
  ]);
  const result: PartialFACSLikeState = {};

  for (const key of keys) {
    const start = from.pose[key] ?? 0;
    const end = to.pose[key] ?? 0;
    result[key] = start + (end - start) * eased;
  }

  return clampFACSState(result);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function withConservativeFallback(capabilities: ModelCapabilities): ModelCapabilities {
  if (Object.values(capabilities).some(Boolean)) return capabilities;

  return {
    ...capabilities,
    headControl: true,
    bodyControl: true,
    eyeBlink: true,
    gazeControl: true,
    browControl: true
  };
}
