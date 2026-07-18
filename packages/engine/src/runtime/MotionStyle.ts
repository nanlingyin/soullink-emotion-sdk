import { clamp } from "../utils/clamp";

export interface MotionStyleOptions {
  /** Reuse a seed to reproduce the same local motion sequence. */
  seed?: number;
  /** Overall chance of low-frequency spontaneous idle actions. */
  spontaneity?: number;
  /** Frequency multiplier for VAD transition gestures. */
  gestureFrequency?: number;
  /** 0 looks around often, 1 keeps the gaze comparatively steady. */
  gazeStability?: number;
  /** Natural blink frequency multiplier. */
  blinkRate?: number;
  /** Breathing tempo multiplier. */
  breathRate?: number;
  /** Amount of non-periodic breathing variation. */
  breathVariance?: number;
  /** Gain applied to continuous small head and face motion. */
  microMotionGain?: number;
  /** Gain applied to discrete spontaneous idle actions. */
  idleActionGain?: number;
  /** Number of recent action labels avoided when choosing the next action. */
  avoidRepeatWindow?: number;
  /** Gain applied to speech-onset and speech-peak accents. */
  speechAccentGain?: number;
}

export interface ResolvedMotionStyle {
  seed: number;
  spontaneity: number;
  gestureFrequency: number;
  gazeStability: number;
  blinkRate: number;
  breathRate: number;
  breathVariance: number;
  microMotionGain: number;
  idleActionGain: number;
  avoidRepeatWindow: number;
  speechAccentGain: number;
}

export type MotionStylePresetName = "natural" | "lively" | "calm" | "shy";

export const motionStylePresets: Readonly<Record<MotionStylePresetName, Readonly<MotionStyleOptions>>> = {
  natural: {
    spontaneity: 1,
    gestureFrequency: 1,
    gazeStability: 0.72,
    blinkRate: 1,
    breathRate: 1,
    breathVariance: 0.42,
    microMotionGain: 1,
    idleActionGain: 1,
    avoidRepeatWindow: 3,
    speechAccentGain: 1
  },
  lively: {
    spontaneity: 1.32,
    gestureFrequency: 1.3,
    gazeStability: 0.5,
    blinkRate: 1.12,
    breathRate: 1.06,
    breathVariance: 0.58,
    microMotionGain: 1.16,
    idleActionGain: 1.12,
    avoidRepeatWindow: 4,
    speechAccentGain: 1.12
  },
  calm: {
    spontaneity: 0.68,
    gestureFrequency: 0.76,
    gazeStability: 0.86,
    blinkRate: 0.84,
    breathRate: 0.82,
    breathVariance: 0.28,
    microMotionGain: 0.72,
    idleActionGain: 0.8,
    avoidRepeatWindow: 4,
    speechAccentGain: 0.72
  },
  shy: {
    spontaneity: 0.92,
    gestureFrequency: 0.9,
    gazeStability: 0.56,
    blinkRate: 1.16,
    breathRate: 0.96,
    breathVariance: 0.52,
    microMotionGain: 0.9,
    idleActionGain: 0.88,
    avoidRepeatWindow: 4,
    speechAccentGain: 0.86
  }
};

export function resolveMotionStyle(
  options: MotionStyleOptions = {},
  fallbackGazeStability = 0.72,
  fallbackSeed = createMotionSeed()
): ResolvedMotionStyle {
  return {
    seed: normalizeSeed(options.seed ?? fallbackSeed),
    spontaneity: clamp(options.spontaneity ?? 1, 0, 2),
    gestureFrequency: clamp(options.gestureFrequency ?? 1, 0, 2.5),
    gazeStability: clamp(options.gazeStability ?? fallbackGazeStability, 0, 1),
    blinkRate: clamp(options.blinkRate ?? 1, 0.25, 2.5),
    breathRate: clamp(options.breathRate ?? 1, 0.5, 1.8),
    breathVariance: clamp(options.breathVariance ?? 0.42, 0, 1),
    microMotionGain: clamp(options.microMotionGain ?? 1, 0, 2),
    idleActionGain: clamp(options.idleActionGain ?? 1, 0, 2),
    avoidRepeatWindow: Math.round(clamp(options.avoidRepeatWindow ?? 3, 0, 8)),
    speechAccentGain: clamp(options.speechAccentGain ?? 1, 0, 2)
  };
}

export function createMotionSeed(): number {
  const time = Date.now() >>> 0;
  const random = Math.floor(Math.random() * 0xffffffff) >>> 0;
  return normalizeSeed(time ^ random);
}

export function deriveMotionSeed(seed: number, channel: number): number {
  let value = (normalizeSeed(seed) ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return normalizeSeed(value);
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1;
  return (Math.abs(Math.floor(seed)) >>> 0) || 1;
}
