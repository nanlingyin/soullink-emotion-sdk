export interface FACSActionUnitState {
  au01InnerBrowRaiser: number;
  au02OuterBrowRaiser: number;
  au04BrowLowerer: number;
  au05UpperLidRaiser: number;
  au06CheekRaiser: number;
  au07LidTightener: number;
  au09NoseWrinkler: number;
  au10UpperLipRaiser: number;
  au12LipCornerPuller: number;
  au14Dimpler: number;
  au15LipCornerDepressor: number;
  au17ChinRaiser: number;
  au18LipPucker: number;
  au20LipStretcher: number;
  au23LipTightener: number;
  au24LipPressor: number;
  au25LipsPart: number;
  au26JawDrop: number;
  au27MouthStretch: number;
  au45Blink: number;

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

export type FACSActionUnitKey = keyof FACSActionUnitState;
export type PartialFACSActionUnitState = Partial<FACSActionUnitState>;

export interface ActionUnitDefinition {
  key: FACSActionUnitKey;
  code: string;
  label: string;
  group: "brow" | "eye" | "midface" | "mouth" | "extension";
  min: number;
  max: number;
}

export const actionUnitDefinitions: ActionUnitDefinition[] = [
  { key: "au01InnerBrowRaiser", code: "AU01", label: "Inner Brow Raiser", group: "brow", min: 0, max: 1 },
  { key: "au02OuterBrowRaiser", code: "AU02", label: "Outer Brow Raiser", group: "brow", min: 0, max: 1 },
  { key: "au04BrowLowerer", code: "AU04", label: "Brow Lowerer", group: "brow", min: 0, max: 1 },
  { key: "au05UpperLidRaiser", code: "AU05", label: "Upper Lid Raiser", group: "eye", min: 0, max: 1 },
  { key: "au06CheekRaiser", code: "AU06", label: "Cheek Raiser", group: "eye", min: 0, max: 1 },
  { key: "au07LidTightener", code: "AU07", label: "Lid Tightener", group: "eye", min: 0, max: 1 },
  { key: "au09NoseWrinkler", code: "AU09", label: "Nose Wrinkler", group: "midface", min: 0, max: 1 },
  { key: "au10UpperLipRaiser", code: "AU10", label: "Upper Lip Raiser", group: "mouth", min: 0, max: 1 },
  { key: "au12LipCornerPuller", code: "AU12", label: "Lip Corner Puller", group: "mouth", min: 0, max: 1 },
  { key: "au14Dimpler", code: "AU14", label: "Dimpler", group: "mouth", min: 0, max: 1 },
  { key: "au15LipCornerDepressor", code: "AU15", label: "Lip Corner Depressor", group: "mouth", min: 0, max: 1 },
  { key: "au17ChinRaiser", code: "AU17", label: "Chin Raiser", group: "mouth", min: 0, max: 1 },
  { key: "au18LipPucker", code: "AU18", label: "Lip Pucker", group: "mouth", min: 0, max: 1 },
  { key: "au20LipStretcher", code: "AU20", label: "Lip Stretcher", group: "mouth", min: 0, max: 1 },
  { key: "au23LipTightener", code: "AU23", label: "Lip Tightener", group: "mouth", min: 0, max: 1 },
  { key: "au24LipPressor", code: "AU24", label: "Lip Pressor", group: "mouth", min: 0, max: 1 },
  { key: "au25LipsPart", code: "AU25", label: "Lips Part", group: "mouth", min: 0, max: 1 },
  { key: "au26JawDrop", code: "AU26", label: "Jaw Drop", group: "mouth", min: 0, max: 1 },
  { key: "au27MouthStretch", code: "AU27", label: "Mouth Stretch", group: "mouth", min: 0, max: 1 },
  { key: "au45Blink", code: "AU45", label: "Blink", group: "eye", min: 0, max: 1 },
  { key: "gazeX", code: "GazeX", label: "Gaze X", group: "extension", min: -1, max: 1 },
  { key: "gazeY", code: "GazeY", label: "Gaze Y", group: "extension", min: -1, max: 1 },
  { key: "headX", code: "HeadX", label: "Head X", group: "extension", min: -1, max: 1 },
  { key: "headY", code: "HeadY", label: "Head Y", group: "extension", min: -1, max: 1 },
  { key: "headZ", code: "HeadZ", label: "Head Z", group: "extension", min: -1, max: 1 },
  { key: "bodyX", code: "BodyX", label: "Body X", group: "extension", min: -1, max: 1 },
  { key: "bodyY", code: "BodyY", label: "Body Y", group: "extension", min: -1, max: 1 },
  { key: "bodyZ", code: "BodyZ", label: "Body Z", group: "extension", min: -1, max: 1 },
  { key: "blush", code: "Blush", label: "Blush", group: "extension", min: 0, max: 1 },
  { key: "tear", code: "Tear", label: "Tear", group: "extension", min: 0, max: 1 },
  { key: "sweat", code: "Sweat", label: "Sweat", group: "extension", min: 0, max: 1 },
  { key: "breath", code: "Breath", label: "Breath", group: "extension", min: 0, max: 1 }
];

export const actionUnitKeys = actionUnitDefinitions.map((definition) => definition.key);
