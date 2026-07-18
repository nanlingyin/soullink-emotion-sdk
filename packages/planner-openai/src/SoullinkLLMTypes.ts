import type {
  PartialFACSActionUnitState,
  PartialFACSLikeState,
  VADVector
} from "@soullink-emotion/engine";
import type { EmotionIntent } from "@soullink-emotion/engine";
import type { OpenAIChatMessage, OpenAIClientOptions } from "./openAICompatibleTypes";

export interface SoullinkConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SoullinkLLMPlanRequest {
  message: string;
  conversation?: SoullinkConversationTurn[];
  characterName?: string;
  characterProfile?: string;
  vad?: VADVector;
  model?: string;
  temperature?: number;
  openAI?: OpenAIClientOptions;
}

export interface SoullinkActionBeat {
  time: number;
  duration: number;
  label: string;
  intensity: number;
  facs?: PartialFACSLikeState;
  actionUnits?: PartialFACSActionUnitState;
}

export interface SoullinkLLMPlan {
  intent: EmotionIntent;
  replyDraft: string;
  vadTarget: VADVector;
  vadDelta: VADVector;
  actionPlan: SoullinkActionBeat[];
  provider: "openai-compatible" | "fallback";
  rawMessage?: OpenAIChatMessage;
}

