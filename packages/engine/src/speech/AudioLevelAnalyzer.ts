export interface AudioLevelAnalyzer {
  getLevel(): number;
  /** Optional instantaneous peak, normalized to 0..1. */
  getPeak?(): number;
  /** Optional availability signal for sources that can temporarily lose audio. */
  isAvailable?(): boolean;
  /** Alias accepted by lightweight adapters that expose availability directly. */
  available?(): boolean;
  /** Clear source-side smoothing/buffering when speech ends. */
  reset?(): void;
}

export class NullAudioLevelAnalyzer implements AudioLevelAnalyzer {
  getLevel(): number {
    return 0;
  }

  getPeak(): number {
    return 0;
  }

  isAvailable(): boolean {
    return false;
  }

  available(): boolean {
    return false;
  }

  reset(): void {
    // Intentionally empty: this analyzer never exposes a live source.
  }
}
