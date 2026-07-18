import type { PartialFACSActionUnitState } from "../facs/FACSActionUnitState";
import type { Live2DParamState, PartialFACSLikeState } from "../facs/FACSLikeState";
import type { VADVector } from "../emotion/VADState";
import type { EmotionIntent } from "./EmotionIntent";

export interface SoullinkActionBeat {
  time: number;
  duration: number;
  label: string;
  intensity: number;
  facs?: PartialFACSLikeState;
  actionUnits?: PartialFACSActionUnitState;
}

export interface SoullinkParameterBeat {
  time: number;
  duration: number;
  label?: string;
  parameters: Live2DParamState;
}

export interface SoullinkExternalPlan {
  intent: EmotionIntent;
  replyDraft?: string;
  vadTarget?: Partial<VADVector>;
  vadDelta?: Partial<VADVector>;
  actionPlan?: SoullinkActionBeat[];
  parameterPlan?: SoullinkParameterBeat[];
  provider?: string;
}

export interface SoullinkReflectionState {
  thought: string;
  reason: string;
  vadTarget?: Partial<VADVector>;
  emotion?: string;
  createdAt: number;
}

export interface SoullinkProactiveEvent {
  id: string;
  emotion: string;
  intensity: number;
  silenceSeconds: number;
  suggestedMessage: string;
  systemPrompt: string;
  reason: string;
  createdAt: number;
}

export interface SoullinkPlanRuntimeState {
  provider: string;
  replyDraft: string;
  actionBeatCount: number;
  parameterBeatCount?: number;
  startedAt: number;
}
