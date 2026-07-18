import type { VADVector } from "./VADState";

export const neutralVAD: VADVector = {
  valence: 0,
  arousal: 0,
  dominance: 0
};

export const emotionVADPresets: Record<string, VADVector> = {
  neutral: neutralVAD,
  calm: { valence: 0.25, arousal: -0.45, dominance: 0.2 },
  happy: { valence: 0.75, arousal: 0.45, dominance: 0.35 },
  excited: { valence: 0.85, arousal: 0.85, dominance: 0.45 },
  shy: { valence: 0.35, arousal: 0.6, dominance: -0.45 },
  affectionate: { valence: 0.65, arousal: 0.1, dominance: 0.1 },
  curious: { valence: 0.35, arousal: 0.55, dominance: 0.2 },
  confused: { valence: -0.1, arousal: 0.35, dominance: -0.3 },
  tired: { valence: -0.25, arousal: -0.7, dominance: -0.3 },
  sad: { valence: -0.65, arousal: -0.45, dominance: -0.5 },
  anxiety: { valence: -0.6, arousal: 0.7, dominance: -0.55 },
  anger: { valence: -0.7, arousal: 0.75, dominance: 0.55 },
  angry: { valence: -0.7, arousal: 0.75, dominance: 0.55 },
  concerned: { valence: -0.18, arousal: 0.28, dominance: -0.2 },
  surprised: { valence: 0.18, arousal: 0.78, dominance: -0.08 }
};

export function getVADPreset(emotion: string, variant?: string): VADVector {
  if (variant?.includes("shy")) return emotionVADPresets.shy;
  if (variant?.includes("comfort")) return emotion === "concerned" ? emotionVADPresets.concerned : emotionVADPresets.affectionate;
  if (variant?.includes("startled")) return emotionVADPresets.surprised;
  return emotionVADPresets[emotion] ?? neutralVAD;
}
