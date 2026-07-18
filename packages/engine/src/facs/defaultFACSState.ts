import type { FACSLikeState, PartialFACSLikeState } from "./FACSLikeState";

export function createDefaultFACSState(overrides: PartialFACSLikeState = {}): FACSLikeState {
  return {
    browInnerUp: 0,
    browOuterUp: 0,
    browDown: 0,

    eyeOpen: 1,
    eyeSmile: 0,
    eyeSquint: 0,
    eyeBlinkL: 0,
    eyeBlinkR: 0,

    mouthSmile: 0.04,
    mouthFrown: 0,
    mouthOpen: 0,
    mouthPucker: 0,

    gazeX: 0,
    gazeY: 0,

    headX: 0,
    headY: 0,
    headZ: 0,

    bodyX: 0,
    bodyY: 0,
    bodyZ: 0,

    blush: 0,
    tear: 0,
    sweat: 0,

    breath: 0.5,
    ...overrides
  };
}

export const defaultFACSState = createDefaultFACSState();
