import { clampFACSState } from "../facs/FACSUtils";
import type { FACSLikeState, PartialFACSLikeState } from "../facs/FACSLikeState";
import type { PartialFACSActionUnitState } from "../facs/FACSActionUnitState";
import { normalizeActionUnits } from "../facs/ActionUnitUtils";
import { clamp } from "../utils/clamp";

export class ActionUnitSolver {
  solve(actionUnits: PartialFACSActionUnitState): PartialFACSLikeState {
    const au = normalizeActionUnits(actionUnits);

    const browInnerUp = au.au01InnerBrowRaiser * 0.92;
    const browOuterUp = au.au02OuterBrowRaiser * 0.9 + au.au05UpperLidRaiser * 0.18;
    const browDown = Math.max(au.au04BrowLowerer, au.au09NoseWrinkler * 0.45);

    const eyeSmile = clamp(au.au06CheekRaiser * 0.78 + au.au12LipCornerPuller * 0.12, 0, 1);
    const eyeSquint = clamp(au.au07LidTightener * 0.85 + au.au06CheekRaiser * 0.28, 0, 1);
    const upperLid = au.au05UpperLidRaiser * 0.24;
    const squintClose = au.au07LidTightener * 0.22 + au.au06CheekRaiser * 0.16;
    const eyeOpen = clamp(1 + upperLid - squintClose, 0.45, 1.24);

    const mouthSmile = clamp(au.au12LipCornerPuller * 0.88 + au.au14Dimpler * 0.22, 0, 1);
    const mouthFrown = clamp(au.au15LipCornerDepressor * 0.86 + au.au17ChinRaiser * 0.2, 0, 1);
    const mouthPucker = clamp(au.au18LipPucker * 0.9 + au.au23LipTightener * 0.22 + au.au24LipPressor * 0.18, 0, 1);
    const mouthOpen = clamp(
      au.au25LipsPart * 0.42 + au.au26JawDrop * 0.72 + au.au27MouthStretch * 0.86 + au.au10UpperLipRaiser * 0.16,
      0,
      1
    );

    return clampFACSState({
      browInnerUp,
      browOuterUp,
      browDown,
      eyeOpen,
      eyeSmile,
      eyeSquint,
      eyeBlinkL: au.au45Blink,
      eyeBlinkR: au.au45Blink,
      mouthSmile,
      mouthFrown,
      mouthOpen,
      mouthPucker,
      gazeX: au.gazeX,
      gazeY: au.gazeY,
      headX: au.headX,
      headY: au.headY,
      headZ: au.headZ,
      bodyX: au.bodyX,
      bodyY: au.bodyY,
      bodyZ: au.bodyZ,
      blush: au.blush,
      tear: au.tear,
      sweat: au.sweat,
      breath: au.breath
    });
  }

  solvePartial(actionUnits: PartialFACSActionUnitState): PartialFACSLikeState {
    const solved = this.solve(actionUnits);
    const result: PartialFACSLikeState = {};
    const keys = new Set(Object.keys(actionUnits));

    if (["au01InnerBrowRaiser", "au02OuterBrowRaiser", "au04BrowLowerer", "au05UpperLidRaiser", "au09NoseWrinkler"].some((key) => keys.has(key))) {
      result.browInnerUp = solved.browInnerUp;
      result.browOuterUp = solved.browOuterUp;
      result.browDown = solved.browDown;
    }

    if (["au05UpperLidRaiser", "au06CheekRaiser", "au07LidTightener"].some((key) => keys.has(key))) {
      result.eyeOpen = solved.eyeOpen;
      result.eyeSmile = solved.eyeSmile;
      result.eyeSquint = solved.eyeSquint;
    }

    if (keys.has("au45Blink")) {
      result.eyeBlinkL = solved.eyeBlinkL;
      result.eyeBlinkR = solved.eyeBlinkR;
    }

    if (
      [
        "au10UpperLipRaiser",
        "au12LipCornerPuller",
        "au14Dimpler",
        "au15LipCornerDepressor",
        "au17ChinRaiser",
        "au18LipPucker",
        "au20LipStretcher",
        "au23LipTightener",
        "au24LipPressor",
        "au25LipsPart",
        "au26JawDrop",
        "au27MouthStretch"
      ].some((key) => keys.has(key))
    ) {
      result.mouthSmile = solved.mouthSmile;
      result.mouthFrown = solved.mouthFrown;
      result.mouthOpen = solved.mouthOpen;
      result.mouthPucker = solved.mouthPucker;
    }

    for (const key of ["gazeX", "gazeY", "headX", "headY", "headZ", "bodyX", "bodyY", "bodyZ", "blush", "tear", "sweat", "breath"] as const) {
      if (keys.has(key)) result[key] = solved[key];
    }

    return result;
  }

  project(facs: PartialFACSLikeState): PartialFACSActionUnitState {
    const state = facs as Partial<FACSLikeState>;

    return normalizeActionUnits({
      au01InnerBrowRaiser: state.browInnerUp ?? 0,
      au02OuterBrowRaiser: state.browOuterUp ?? 0,
      au04BrowLowerer: state.browDown ?? 0,
      au05UpperLidRaiser: Math.max(0, (state.eyeOpen ?? 1) - 1) * 3.2,
      au06CheekRaiser: state.eyeSmile ?? 0,
      au07LidTightener: state.eyeSquint ?? 0,
      au12LipCornerPuller: state.mouthSmile ?? 0,
      au15LipCornerDepressor: state.mouthFrown ?? 0,
      au18LipPucker: state.mouthPucker ?? 0,
      au25LipsPart: Math.min(1, (state.mouthOpen ?? 0) * 0.55),
      au26JawDrop: Math.min(1, (state.mouthOpen ?? 0) * 0.8),
      au45Blink: Math.max(state.eyeBlinkL ?? 0, state.eyeBlinkR ?? 0),
      gazeX: state.gazeX ?? 0,
      gazeY: state.gazeY ?? 0,
      headX: state.headX ?? 0,
      headY: state.headY ?? 0,
      headZ: state.headZ ?? 0,
      bodyX: state.bodyX ?? 0,
      bodyY: state.bodyY ?? 0,
      bodyZ: state.bodyZ ?? 0,
      blush: state.blush ?? 0,
      tear: state.tear ?? 0,
      sweat: state.sweat ?? 0,
      breath: state.breath ?? 0.5
    });
  }
}
