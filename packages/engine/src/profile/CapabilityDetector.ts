import type { ModelCapabilities, ModelProfile } from "./ModelProfile";

export function detectCapabilities(profile: ModelProfile): ModelCapabilities {
  const map = profile.parameterMap;

  return {
    headControl: Boolean(map.headX || map.headY || map.headZ),
    bodyControl: Boolean(map.bodyX || map.bodyY || map.bodyZ),
    eyeBlink: Boolean(map.eyeBlinkL || map.eyeBlinkR),
    eyeSmile: Boolean(map.eyeSmile),
    gazeControl: Boolean(map.gazeX || map.gazeY),
    mouthOpen: Boolean(map.mouthOpen),
    mouthSmile: Boolean(map.mouthSmile),
    browControl: Boolean(map.browInnerUp || map.browOuterUp || map.browDown),
    blush: Boolean(map.blush),
    tear: Boolean(map.tear),
    sweat: Boolean(map.sweat),
    breath: Boolean(map.breath)
  };
}
