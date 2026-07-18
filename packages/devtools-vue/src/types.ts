import type {
  AdaptationCoverage,
  ModelProfile,
  ParameterMap,
  PartialFACSLikeState,
  PrivateEmotionMap,
  PrivateEmotionMapping
} from "@soullink-emotion/engine";

export interface CalibrationPanelProps {
  coverage: AdaptationCoverage | null;
  currentProfile: ModelProfile | null;
  /** Optional complete CDI/Core metadata; enables adding rules for any model parameter. */
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
  /** Patch payload; a null entry removes an existing rule on the server. */
  privateEmotionMap?: Record<string, PrivateEmotionMapping | null>;
}

export type PrivateEmotionMapPatch = NonNullable<CalibrationSaveExtras["privateEmotionMap"]>;

/** Vue event tuple map exposed for typed wrappers and host integrations. */
export type CalibrationPanelEmits = {
  "preview-profile": [profile: ModelProfile];
  "save-calibration": [parameterMap: ParameterMap, extras?: CalibrationSaveExtras];
  "manual-facs-change": [facs: PartialFACSLikeState];
  "manual-parameter-change": [parameters: Record<string, number>];
};

export type {
  AdaptationCoverage,
  ModelProfile,
  ParameterMap,
  PartialFACSLikeState,
  PrivateEmotionMap,
  PrivateEmotionMapping
};
