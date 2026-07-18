import type { EasingName } from "../utils/easing";
import type { NumberRange } from "../utils/randomRange";
import type { FACSKey, PartialFACSLikeState } from "../facs/FACSLikeState";

export type FACSRangeMap = Partial<Record<FACSKey, NumberRange>>;

export interface EmotionVariant {
  ranges: FACSRangeMap;
  tags?: string[];
}

export interface EmotionArchetype {
  emotion: string;
  baseTendency: FACSRangeMap;
  variants: Record<string, EmotionVariant>;
}

export interface RuntimeExpressionKeyframe {
  time: number;
  duration: number;
  easing: EasingName;
  facs: PartialFACSLikeState;
  weight?: number;
}

export interface RuntimeExpression {
  emotion: string;
  variant: string;
  intensity: number;
  timeline: RuntimeExpressionKeyframe[];
  peakFACS: PartialFACSLikeState;
  idleBias?: PartialFACSLikeState;
  recoveryDuration: number;
}
