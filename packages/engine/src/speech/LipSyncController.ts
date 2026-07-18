import type { PartialFACSLikeState } from "../facs/FACSLikeState";
import { clamp } from "../utils/clamp";

export interface LipSyncOptions {
  enabled: boolean;
  speaking: boolean;
  intensity: number;
  /** Normalized RMS/audio level. Supplying this enables the measured path. */
  audioLevel?: number;
  /** Optional normalized instantaneous peak used for speech accents. */
  audioPeak?: number;
  /** Frame delta in seconds. The timestamp delta is used when omitted. */
  deltaSeconds?: number;
  /** Multiplier for small head/brow accents caused by local peaks. */
  speechAccentGain?: number;
}

export class LipSyncController {
  private smoothedLevel = 0;
  private previousLevel = 0;
  private previousPeak = 0;
  private accent = 0;
  private accentDirection = 1;
  private lastAccentTime = Number.NEGATIVE_INFINITY;
  private lastTimeSeconds: number | null = null;

  update(timeSeconds: number, options: LipSyncOptions): PartialFACSLikeState {
    if (!options.enabled || !options.speaking) {
      this.reset();
      return {};
    }

    const audio = resolveAudioInput(options);
    if (audio === null) {
      // Keep the legacy procedural path byte-for-byte compatible when no
      // measured level is available. Also discard stale measured state so a
      // later audio frame starts with a clean attack.
      this.reset();
      return this.updateProcedural(timeSeconds, options);
    }

    return this.updateMeasured(timeSeconds, options, audio.level, audio.peak);
  }

  reset(): void {
    this.smoothedLevel = 0;
    this.previousLevel = 0;
    this.previousPeak = 0;
    this.accent = 0;
    this.accentDirection = 1;
    this.lastAccentTime = Number.NEGATIVE_INFINITY;
    this.lastTimeSeconds = null;
  }

  private updateProcedural(timeSeconds: number, options: LipSyncOptions): PartialFACSLikeState {
    const syllable = Math.sin(timeSeconds * 18.5) * 0.5 + Math.sin(timeSeconds * 31.2) * 0.25 + 0.5;
    const mouthOpen = Math.max(0, syllable) * (0.18 + options.intensity * 0.34);

    return {
      mouthOpen,
      headX: Math.sin(timeSeconds * 2.6) * 0.018,
      headY: Math.sin(timeSeconds * 2.1 + 0.8) * 0.012
    };
  }

  private updateMeasured(
    timeSeconds: number,
    options: LipSyncOptions,
    level: number,
    peak: number
  ): PartialFACSLikeState {
    const deltaSeconds = resolveDeltaSeconds(timeSeconds, options.deltaSeconds, this.lastTimeSeconds);
    this.lastTimeSeconds = Number.isFinite(timeSeconds) ? timeSeconds : this.lastTimeSeconds;

    const gatedLevel = level <= AUDIO_NOISE_GATE
      ? 0
      : (level - AUDIO_NOISE_GATE) / (1 - AUDIO_NOISE_GATE);
    const attack = 1 - Math.exp(-deltaSeconds / AUDIO_ATTACK_SECONDS);
    const release = 1 - Math.exp(-deltaSeconds / AUDIO_RELEASE_SECONDS);
    const smoothing = gatedLevel >= this.smoothedLevel ? attack : release;
    this.smoothedLevel += (gatedLevel - this.smoothedLevel) * smoothing;

    this.accent *= Math.exp(-deltaSeconds / SPEECH_ACCENT_DECAY_SECONDS);
    const rise = Math.max(0, peak - Math.max(this.previousPeak, this.previousLevel));
    const accentGain = clamp(finiteOr(options.speechAccentGain, DEFAULT_SPEECH_ACCENT_GAIN), 0, 2);
    if (
      accentGain > 0
      && rise >= SPEECH_ACCENT_RISE_THRESHOLD
      && peak > AUDIO_NOISE_GATE + SPEECH_ACCENT_MIN_PEAK
      && timeSeconds - this.lastAccentTime >= SPEECH_ACCENT_COOLDOWN_SECONDS
    ) {
      const pulse = clamp(0.22 + rise * 1.6, 0, 0.72) * accentGain;
      this.accent = clamp(this.accent * 0.45 + pulse, 0, 0.82);
      this.accentDirection *= -1;
      this.lastAccentTime = timeSeconds;
    }

    this.previousLevel = level;
    this.previousPeak = peak;

    const intensity = clamp(finiteOr(options.intensity, 0), 0, 1);
    const mouthGain = 0.18 + intensity * 0.34;
    const accent = clamp(this.accent, 0, 1);

    return {
      mouthOpen: clamp(this.smoothedLevel * mouthGain, 0, 1),
      browOuterUp: clamp(accent * 0.075, 0, 1),
      headY: clamp(-accent * 0.028, -1, 1),
      headZ: clamp(this.accentDirection * accent * 0.016, -1, 1)
    };
  }
}

const AUDIO_NOISE_GATE = 0.035;
const AUDIO_ATTACK_SECONDS = 0.045;
const AUDIO_RELEASE_SECONDS = 0.13;
const SPEECH_ACCENT_RISE_THRESHOLD = 0.085;
const SPEECH_ACCENT_MIN_PEAK = 0.045;
const SPEECH_ACCENT_COOLDOWN_SECONDS = 0.18;
const SPEECH_ACCENT_DECAY_SECONDS = 0.16;
const DEFAULT_SPEECH_ACCENT_GAIN = 0.8;

interface AudioInput {
  level: number;
  peak: number;
}

function resolveAudioInput(options: LipSyncOptions): AudioInput | null {
  const level = normalizedAudioValue(options.audioLevel);
  const peak = normalizedAudioValue(options.audioPeak);
  // RMS/level is the validity gate. A peak without a level is not enough to
  // replace the established procedural fallback.
  if (level === undefined) return null;

  // RMS drives the mouth; peak only drives accent detection when provided.
  return {
    level,
    peak: peak ?? level ?? 0
  };
}

function normalizedAudioValue(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return clamp(value, 0, 1);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function resolveDeltaSeconds(
  timeSeconds: number,
  explicitDeltaSeconds: number | undefined,
  previousTimeSeconds: number | null
): number {
  if (explicitDeltaSeconds !== undefined && Number.isFinite(explicitDeltaSeconds)) {
    return clamp(Math.max(0, explicitDeltaSeconds), 0, 0.25);
  }

  if (
    previousTimeSeconds !== null
    && Number.isFinite(timeSeconds)
    && timeSeconds >= previousTimeSeconds
  ) {
    return clamp(timeSeconds - previousTimeSeconds, 0, 0.25);
  }

  return 1 / 60;
}
