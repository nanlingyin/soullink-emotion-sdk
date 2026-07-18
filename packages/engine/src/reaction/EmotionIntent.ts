import type { VADVector } from "../emotion/VADState";

export interface EmotionIntent {
  emotion: string;
  variant?: string;
  naturalEmotion?: string;
  naturalVariant?: string;
  naturalVAD?: Partial<VADVector>;
  intensity: number;
  contextTags: string[];
  sourceMessage?: string;
}
