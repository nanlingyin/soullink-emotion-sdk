import type { FACSActionUnitState, PartialFACSActionUnitState } from "./FACSActionUnitState";

export function createDefaultActionUnitState(overrides: PartialFACSActionUnitState = {}): FACSActionUnitState {
  return {
    au01InnerBrowRaiser: 0,
    au02OuterBrowRaiser: 0,
    au04BrowLowerer: 0,
    au05UpperLidRaiser: 0,
    au06CheekRaiser: 0,
    au07LidTightener: 0,
    au09NoseWrinkler: 0,
    au10UpperLipRaiser: 0,
    au12LipCornerPuller: 0,
    au14Dimpler: 0,
    au15LipCornerDepressor: 0,
    au17ChinRaiser: 0,
    au18LipPucker: 0,
    au20LipStretcher: 0,
    au23LipTightener: 0,
    au24LipPressor: 0,
    au25LipsPart: 0,
    au26JawDrop: 0,
    au27MouthStretch: 0,
    au45Blink: 0,

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

export const defaultActionUnitState = createDefaultActionUnitState();
