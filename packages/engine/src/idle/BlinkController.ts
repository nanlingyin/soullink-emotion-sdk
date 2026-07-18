import { ease } from "../utils/easing";
import { clamp } from "../utils/clamp";
import { seededRandom } from "../utils/seededRandom";

export interface BlinkState {
  eyeBlinkL: number;
  eyeBlinkR: number;
}

export class BlinkController {
  private random: () => number;
  private nextBlinkAt = 0;
  private blinkStartedAt: number | null = null;
  private doubleBlinkQueued = false;
  private rate: number;

  constructor(seed = 7, rate = 1) {
    this.random = seededRandom(seed);
    this.rate = clamp(rate, 0.25, 2.5);
    this.scheduleNext(0);
  }

  defer(timeSeconds: number, duration: number) {
    this.blinkStartedAt = null;
    this.doubleBlinkQueued = false;
    const pauseScale = 1 / Math.sqrt(this.rate);
    this.nextBlinkAt = timeSeconds + Math.max(0, duration) + (0.75 + this.random() * 1.15) * pauseScale;
  }

  update(timeSeconds: number, focusLevel: number): BlinkState {
    if (this.blinkStartedAt === null && timeSeconds >= this.nextBlinkAt) {
      this.blinkStartedAt = timeSeconds;
    }

    if (this.blinkStartedAt === null) {
      return { eyeBlinkL: 0, eyeBlinkR: 0 };
    }

    const elapsed = timeSeconds - this.blinkStartedAt;
    const closeDuration = 0.065;
    const holdDuration = 0.035;
    const openDuration = 0.13;
    const total = closeDuration + holdDuration + openDuration;
    let blink = 0;

    if (elapsed <= closeDuration) {
      blink = ease("easeIn", elapsed / closeDuration);
    } else if (elapsed <= closeDuration + holdDuration) {
      blink = 1;
    } else if (elapsed <= total) {
      blink = 1 - ease("easeOut", (elapsed - closeDuration - holdDuration) / openDuration);
    } else {
      const doubleBlinkChance = focusLevel > 0.4 ? 0 : Math.min(0.24, 0.16 * this.rate);
      const shouldDouble = !this.doubleBlinkQueued && this.random() < doubleBlinkChance;
      this.blinkStartedAt = null;

      if (shouldDouble) {
        this.doubleBlinkQueued = true;
        this.nextBlinkAt = timeSeconds + 0.18 + this.random() * 0.12;
      } else {
        this.doubleBlinkQueued = false;
        this.scheduleNext(timeSeconds, focusLevel);
      }
    }

    return {
      eyeBlinkL: blink,
      eyeBlinkR: blink
    };
  }

  private scheduleNext(timeSeconds: number, focusLevel = 0) {
    const base = (3 + this.random() * 4) / this.rate;
    const focusedExtra = focusLevel * 1.1;
    this.nextBlinkAt = timeSeconds + base + focusedExtra;
  }
}
