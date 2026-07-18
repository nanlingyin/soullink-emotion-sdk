import type { PartialFACSLikeState } from "../facs/FACSLikeState";
import type { ModelProfile } from "./ModelProfile";

export function applyFallbackStrategies(
  facs: PartialFACSLikeState,
  profile: ModelProfile
): PartialFACSLikeState {
  const result = { ...facs };
  const map = profile.parameterMap;

  if ((result.eyeSmile ?? 0) > 0 && !map.eyeSmile && map.eyeOpen) {
    result.eyeOpen = Math.max(0, (result.eyeOpen ?? 1) - (result.eyeSmile ?? 0) * 0.22);
  }

  if (((result.gazeX ?? 0) !== 0 || (result.gazeY ?? 0) !== 0) && !map.gazeX && map.headX) {
    result.headX = (result.headX ?? 0) + (result.gazeX ?? 0) * 0.35;
    result.headY = (result.headY ?? 0) + (result.gazeY ?? 0) * 0.2;
  }

  if ((result.breath ?? 0) !== 0 && !map.breath && map.bodyY) {
    result.bodyY = (result.bodyY ?? 0) + ((result.breath ?? 0.5) - 0.5) * 0.12;
  }

  if (!profile.capabilities?.blush) delete result.blush;
  if (!profile.capabilities?.tear) delete result.tear;
  if (!profile.capabilities?.sweat) delete result.sweat;

  return result;
}
