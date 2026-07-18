import type { FACSKey } from "../facs/FACSLikeState";

export const additiveFACSKeys = new Set<FACSKey>([
  "headX",
  "headY",
  "headZ",
  "bodyX",
  "bodyY",
  "bodyZ",
  "breath",
  "eyeBlinkL",
  "eyeBlinkR"
]);

export const maxFACSKeys = new Set<FACSKey>([
  "mouthOpen",
  "blush",
  "tear",
  "sweat"
]);
