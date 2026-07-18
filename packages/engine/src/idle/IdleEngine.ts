import { addFACS } from "../facs/FACSUtils";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";
import type { ModelProfile } from "../profile/ModelProfile";
import { BlinkController } from "./BlinkController";
import { BodySwayController } from "./BodySwayController";
import { BreathingController } from "./BreathingController";
import { GazeController } from "./GazeController";
import { IdleBiasController } from "./IdleBiasController";
import { MicroMotionController } from "./MicroMotionController";
import { deriveMotionSeed } from "../runtime/MotionStyle";

export interface IdleEngineStyle {
  seed?: number;
  gazeStability?: number;
  blinkRate?: number;
  breathRate?: number;
  breathVariance?: number;
  microMotionGain?: number;
}

export interface IdleEngineOptions {
  enabled: boolean;
  focusLevel: number;
  profile: ModelProfile;
  bodyMotionGain?: number;
}

export class IdleEngine {
  private blink: BlinkController;
  private gaze: GazeController;
  private breathing: BreathingController;
  private microMotion: MicroMotionController;
  private bodySway: BodySwayController;
  private bias = new IdleBiasController();
  private style: Required<IdleEngineStyle>;

  constructor(style: IdleEngineStyle = {}) {
    this.style = {
      seed: style.seed ?? 1,
      gazeStability: style.gazeStability ?? 0.72,
      blinkRate: style.blinkRate ?? 1,
      breathRate: style.breathRate ?? 1,
      breathVariance: style.breathVariance ?? 0.42,
      microMotionGain: style.microMotionGain ?? 1
    };
    this.blink = new BlinkController(deriveMotionSeed(this.style.seed, 1), this.style.blinkRate);
    this.gaze = new GazeController(deriveMotionSeed(this.style.seed, 2), this.style.gazeStability);
    this.breathing = new BreathingController(deriveMotionSeed(this.style.seed, 3));
    this.microMotion = new MicroMotionController(deriveMotionSeed(this.style.seed, 4));
    this.bodySway = new BodySwayController(deriveMotionSeed(this.style.seed, 5));
  }

  setBias(bias: PartialFACSLikeState, duration: number, timeSeconds: number) {
    this.bias.setBias(bias, duration, timeSeconds);
  }

  deferBlink(timeSeconds: number, duration: number) {
    this.blink.defer(timeSeconds, duration);
  }

  resetBias() {
    this.bias.reset();
  }

  reset() {
    this.bias.reset();
    this.blink = new BlinkController(deriveMotionSeed(this.style.seed, 1), this.style.blinkRate);
    this.gaze = new GazeController(deriveMotionSeed(this.style.seed, 2), this.style.gazeStability);
    this.breathing = new BreathingController(deriveMotionSeed(this.style.seed, 3));
    this.microMotion = new MicroMotionController(deriveMotionSeed(this.style.seed, 4));
    this.bodySway = new BodySwayController(deriveMotionSeed(this.style.seed, 5));
  }

  update(timeSeconds: number, options: IdleEngineOptions): PartialFACSLikeState {
    if (!options.enabled) {
      return this.bias.update(timeSeconds);
    }

    const focusLevel = options.focusLevel;
    let result: PartialFACSLikeState = {};

    result = addFACS(result, this.breathing.update(timeSeconds, {
      rate: this.style.breathRate,
      variance: this.style.breathVariance
    }));
    result = addFACS(result, this.microMotion.update(timeSeconds, focusLevel, this.style.microMotionGain));
    result = addFACS(result, this.bodySway.update(timeSeconds, focusLevel, options.profile, options.bodyMotionGain ?? 1));
    result = addFACS(result, this.gaze.update(timeSeconds, focusLevel, options.profile.idleConfig));
    result = addFACS(result, this.blink.update(timeSeconds, focusLevel));
    result = addFACS(result, this.bias.update(timeSeconds));

    return result;
  }
}
