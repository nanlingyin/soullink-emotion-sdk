export interface FACSLikeState {
  browInnerUp: number;
  browOuterUp: number;
  browDown: number;

  eyeOpen: number;
  eyeSmile: number;
  eyeSquint: number;
  eyeBlinkL: number;
  eyeBlinkR: number;

  mouthSmile: number;
  mouthFrown: number;
  mouthOpen: number;
  mouthPucker: number;

  gazeX: number;
  gazeY: number;

  headX: number;
  headY: number;
  headZ: number;

  bodyX: number;
  bodyY: number;
  bodyZ: number;

  blush: number;
  tear: number;
  sweat: number;

  breath: number;
}

export type FACSKey = keyof FACSLikeState;
export type PartialFACSLikeState = Partial<FACSLikeState>;
export type Live2DParamState = Record<string, number>;
