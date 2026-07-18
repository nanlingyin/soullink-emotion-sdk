import type {
  AdaptationCoverage,
  ModelProfile,
  ParameterMap,
  PartialFACSLikeState,
  PrivateEmotionMap,
  PrivateEmotionMapping
} from "@soullink-emotion/engine";
import type { ComponentOptionsMixin, DefineComponent } from "vue";

export interface CalibrationPanelProps {
  coverage: AdaptationCoverage | null;
  currentProfile: ModelProfile | null;
  parameters?: Record<string, CalibrationParameterInfo>;
}

export interface CalibrationParameterInfo {
  name?: string;
  groupId?: string;
  groupName?: string;
  min: number;
  max: number;
  default: number;
}

export interface CalibrationSaveExtras {
  privateEmotionMap?: Record<string, PrivateEmotionMapping | null>;
}

export type PrivateEmotionMapPatch = NonNullable<CalibrationSaveExtras["privateEmotionMap"]>;

export type CalibrationPanelEmits = {
  "preview-profile": [profile: ModelProfile];
  "save-calibration": [parameterMap: ParameterMap, extras?: CalibrationSaveExtras];
  "manual-facs-change": [facs: PartialFACSLikeState];
  "manual-parameter-change": [parameters: Record<string, number>];
};

type CalibrationPanelVueEmits = {
  [Event in keyof CalibrationPanelEmits]: (...args: CalibrationPanelEmits[Event]) => void;
};

export declare const CalibrationPanel: DefineComponent<
  CalibrationPanelProps,
  {},
  {},
  {},
  {},
  ComponentOptionsMixin,
  ComponentOptionsMixin,
  CalibrationPanelVueEmits
>;

export default CalibrationPanel;

export declare function clonePrivateEmotionMap(map: PrivateEmotionMap | undefined): PrivateEmotionMap;
export declare function buildPrivateEmotionMapPatch(
  original: PrivateEmotionMap | undefined,
  current: PrivateEmotionMap | undefined
): PrivateEmotionMapPatch;

export type {
  AdaptationCoverage,
  ModelProfile,
  ParameterMap,
  PartialFACSLikeState,
  PrivateEmotionMap,
  PrivateEmotionMapping
};
