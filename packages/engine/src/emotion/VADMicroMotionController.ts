import { addFACS, clampFACSState } from "../facs/FACSUtils";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";
import { clamp } from "../utils/clamp";
import { seededRandom, type RandomSource } from "../utils/seededRandom";
import type { VADVector } from "./VADState";

interface VADPulse {
  startedAt: number;
  duration: number;
  vector: VADVector;
  amplitude: number;
  side: number;
}

const neutralVAD: VADVector = {
  valence: 0,
  arousal: 0,
  dominance: 0
};

function deltaMagnitude(vector: VADVector): number {
  return Math.abs(vector.valence) + Math.abs(vector.arousal) * 0.82 + Math.abs(vector.dominance) * 0.62;
}

export class VADMicroMotionController {
  private previous: VADVector | null = null;
  private pulse: VADPulse | null = null;
  private random: RandomSource;
  private nextAllowedPulseAt = 0;
  private phases: [number, number, number];

  constructor(private readonly seed = 4421) {
    this.random = seededRandom(seed);
    this.phases = this.createPhases();
  }

  reset() {
    this.previous = null;
    this.pulse = null;
    this.nextAllowedPulseAt = 0;
    this.random = seededRandom(this.seed);
    this.phases = this.createPhases();
  }

  update(timeSeconds: number, vad: VADVector, focusLevel: number, bodyMotionGain = 1): PartialFACSLikeState {
    const focus = clamp(focusLevel, 0, 1);
    const motionGain = clamp(bodyMotionGain, 0, 4);
    const delta = this.getDelta(vad);

    this.maybeStartPulse(timeSeconds, delta, focus);
    this.previous = { ...vad };

    return addFACS(
      this.continuousLayer(timeSeconds, vad, focus, motionGain),
      this.pulseLayer(timeSeconds, focus, motionGain)
    );
  }

  private getDelta(vad: VADVector): VADVector {
    const previous = this.previous ?? neutralVAD;
    return {
      valence: vad.valence - previous.valence,
      arousal: vad.arousal - previous.arousal,
      dominance: vad.dominance - previous.dominance
    };
  }

  private maybeStartPulse(timeSeconds: number, delta: VADVector, focus: number) {
    const magnitude = deltaMagnitude(delta);
    const threshold = focus > 0.5 ? 0.012 : 0.0048;

    if (magnitude < threshold || timeSeconds < this.nextAllowedPulseAt) return;

    this.pulse = {
      startedAt: timeSeconds,
      duration: 0.42 + this.random() * 0.38,
      vector: delta,
      amplitude: clamp(magnitude * 2.7, 0.018, 0.12) * (1 - focus * 0.48),
      side: this.random() < 0.5 ? -1 : 1
    };
    this.nextAllowedPulseAt = timeSeconds + 0.42 + this.random() * 0.7;
  }

  private continuousLayer(timeSeconds: number, vad: VADVector, focus: number, motionGain: number): PartialFACSLikeState {
    const magnitude = clamp(deltaMagnitude(vad) * 0.85, 0, 0.1);
    if (magnitude < 0.003) return {};

    const idleWeight = 1 - focus * 0.56;
    const slow = Math.sin(timeSeconds * 0.86 + vad.valence * 9.2 + this.phases[0]);
    const mid = Math.sin(timeSeconds * 1.34 + vad.arousal * 7.6 + 1.7 + this.phases[1]);
    const side = Math.sin(timeSeconds * 0.47 + vad.dominance * 5.1 + this.phases[2]);
    const positive = Math.max(0, vad.valence);
    const negative = Math.max(0, -vad.valence);
    const aroused = Math.max(0, vad.arousal);
    const calm = Math.max(0, -vad.arousal);
    const submissive = Math.max(0, -vad.dominance);
    const dominant = Math.max(0, vad.dominance);

    return clampFACSState({
      mouthSmile: positive * 0.026 * (0.7 + slow * 0.3) * idleWeight,
      mouthFrown: negative * 0.018 * (0.75 + mid * 0.25) * idleWeight,
      browInnerUp: (negative * 0.024 + submissive * 0.012) * (0.74 + slow * 0.22) * idleWeight,
      browOuterUp: aroused * 0.018 * (0.72 + mid * 0.25) * idleWeight,
      eyeSmile: positive * 0.02 * (0.75 + slow * 0.2) * idleWeight,
      eyeSquint: (negative * 0.014 + calm * 0.01) * (0.75 + mid * 0.2) * idleWeight,
      bodyX: (side * 0.008 + vad.valence * 0.01) * idleWeight * motionGain,
      bodyY: (vad.arousal * 0.008 + dominant * 0.006 - submissive * 0.007 + slow * magnitude * 0.018) * idleWeight * motionGain,
      bodyZ: (vad.dominance * 0.012 + side * magnitude * 0.03) * idleWeight * motionGain,
      headX: (side * magnitude * 0.024 + vad.valence * 0.006) * idleWeight * motionGain,
      headY: (vad.arousal * 0.01 + vad.dominance * 0.006 - submissive * 0.008) * idleWeight * motionGain,
      headZ: (vad.valence * submissive * -0.022 + vad.dominance * 0.012 + side * magnitude * 0.04) * idleWeight * motionGain,
      gazeY: (dominant * 0.008 - submissive * 0.014 + calm * -0.006) * idleWeight * Math.min(1.7, motionGain)
    });
  }

  private pulseLayer(timeSeconds: number, focus: number, motionGain: number): PartialFACSLikeState {
    if (!this.pulse) return {};

    const progress = (timeSeconds - this.pulse.startedAt) / this.pulse.duration;
    if (progress >= 1) {
      this.pulse = null;
      return {};
    }

    const envelope = Math.sin(Math.PI * clamp(progress, 0, 1));
    const amplitude = this.pulse.amplitude * envelope * (1 - focus * 0.34);
    const vector = this.pulse.vector;
    const positive = Math.max(0, vector.valence);
    const negative = Math.max(0, -vector.valence);
    const aroused = Math.max(0, vector.arousal);
    const calm = Math.max(0, -vector.arousal);
    const submissive = Math.max(0, -vector.dominance);
    const dominant = Math.max(0, vector.dominance);

    return clampFACSState({
      mouthSmile: positive * amplitude * 1.1,
      mouthFrown: negative * amplitude * 0.9,
      browInnerUp: (negative * 0.9 + submissive * 0.45) * amplitude,
      browOuterUp: aroused * amplitude * 0.8,
      browDown: dominant * negative * amplitude * 0.9,
      eyeSmile: positive * amplitude * 0.65,
      eyeSquint: (negative * dominant + calm * 0.3) * amplitude * 0.7,
      mouthOpen: aroused * amplitude * 0.34,
      bodyX: this.pulse.side * amplitude * 0.18 * motionGain,
      bodyY: (aroused * 0.12 - calm * 0.08 + dominant * 0.06 - submissive * 0.06) * amplitude * motionGain,
      bodyZ: ((dominant - submissive) * amplitude * 0.16 + this.pulse.side * amplitude * 0.08) * motionGain,
      headX: this.pulse.side * amplitude * 0.1 * motionGain,
      headY: (aroused * 0.12 + dominant * 0.07 - submissive * 0.08) * amplitude * motionGain,
      headZ: this.pulse.side * amplitude * 0.14 * motionGain
    });
  }

  private createPhases(): [number, number, number] {
    return [this.random() * Math.PI * 2, this.random() * Math.PI * 2, this.random() * Math.PI * 2];
  }
}
