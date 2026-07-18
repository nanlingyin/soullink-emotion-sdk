export interface VADVector {
  valence: number;
  arousal: number;
  dominance: number;
}

export interface VADRuntimeState {
  current: VADVector;
  target: VADVector;
  dominantEmotion: string;
  intensity: number;
  ambient?: VADVector;
  holdSeconds?: number;
  decayRate?: number;
}
