import type { CharacterState } from "../state/CharacterState";
import type { VADRuntimeState } from "./VADState";
import type { SoullinkProactiveEvent } from "../reaction/SoullinkPlan";
import { seededRandom } from "../utils/seededRandom";
import { emotionVADPresets } from "./EmotionPresetRegistry";

export interface ProactiveControllerOptions {
  silenceThresholdSeconds?: number;
  longSilenceSeconds?: number;
  cooldownSeconds?: number;
  settledIntensityThreshold?: number;
  targetSettledIntensityThreshold?: number;
  settledHoldSeconds?: number;
  repeatOnSettledVAD?: boolean;
  repeatAxisThreshold?: number;
}

const messageByEmotion: Record<string, string> = {
  happy: "我刚刚还在想着刚才那个开心的点，要不要继续聊聊？",
  excited: "我有点兴奋，感觉刚才那个话题还能继续展开。",
  shy: "我有点不好意思，但还是想问问你还在吗？",
  affectionate: "我有点想靠近一点继续陪你说话。",
  calm: "我现在挺安静的，想陪你慢慢聊。",
  curious: "我突然有点好奇，你刚才那件事后来怎么样了？",
  confused: "我还在琢磨刚才那句话，想再确认一下。",
  concerned: "我有点担心你，想问问现在好些了吗？",
  anxiety: "我有点不安，想确认你还好吗？",
  anger: "我还在介意刚才那件事，想和你一起理一下。",
  angry: "我还在介意刚才那件事，想和你一起理一下。",
  sad: "我有点低落，但还是想陪你待一会儿。",
  tired: "我有点困，但还想听你说话。",
  neutral: "你有一会儿没说话了，我还在这里。"
};

const repeatVADPresetEmotionPool = Object.keys(emotionVADPresets).filter((emotion) => {
  return emotion !== "neutral" && emotion !== "angry";
});

export class ProactiveController {
  private silenceThresholdSeconds: number;
  private longSilenceSeconds: number;
  private cooldownSeconds: number;
  private settledIntensityThreshold: number;
  private targetSettledIntensityThreshold: number;
  private settledHoldSeconds: number;
  private repeatOnSettledVAD: boolean;
  private repeatAxisThreshold: number;
  private random = seededRandom(74119);
  private lastUserInteractionAt = 0;
  private lastEventAt = Number.NEGATIVE_INFINITY;
  private settledSince: number | null = null;
  private firedSinceInteraction = false;
  private currentEvent: SoullinkProactiveEvent | null = null;

  constructor(options: ProactiveControllerOptions = {}) {
    this.silenceThresholdSeconds = options.silenceThresholdSeconds ?? 42;
    this.longSilenceSeconds = options.longSilenceSeconds ?? 95;
    this.cooldownSeconds = options.cooldownSeconds ?? 120;
    this.settledIntensityThreshold = options.settledIntensityThreshold ?? 0.09;
    this.targetSettledIntensityThreshold = options.targetSettledIntensityThreshold ?? 0.11;
    this.settledHoldSeconds = options.settledHoldSeconds ?? 5;
    this.repeatOnSettledVAD = options.repeatOnSettledVAD ?? false;
    this.repeatAxisThreshold = options.repeatAxisThreshold ?? 0.1;
  }

  setRepeatOnSettledVAD(enabled: boolean) {
    this.repeatOnSettledVAD = enabled;
  }

  get repeatEnabled(): boolean {
    return this.repeatOnSettledVAD;
  }

  reset(timeSeconds = 0) {
    this.lastUserInteractionAt = timeSeconds;
    this.lastEventAt = Number.NEGATIVE_INFINITY;
    this.settledSince = null;
    this.firedSinceInteraction = false;
    this.currentEvent = null;
  }

  notifyUserInteraction(timeSeconds: number) {
    this.lastUserInteractionAt = timeSeconds;
    this.settledSince = null;
    this.firedSinceInteraction = false;
    this.currentEvent = null;
  }

  consume() {
    this.currentEvent = null;
  }

  update(timeSeconds: number, state: CharacterState, vad: VADRuntimeState): SoullinkProactiveEvent | null {
    if (this.currentEvent) return this.currentEvent;
    if (state !== "IDLE") return null;

    const silenceSeconds = Math.max(0, timeSeconds - this.lastUserInteractionAt);
    if (silenceSeconds < this.silenceThresholdSeconds) return null;
    if (!this.repeatOnSettledVAD && this.firedSinceInteraction) return null;
    const cooldownSeconds = this.repeatOnSettledVAD ? 0 : this.cooldownSeconds;
    if (timeSeconds - this.lastEventAt < cooldownSeconds) return null;

    if (!this.isVADSettled(timeSeconds, vad)) return null;

    const longSilence = silenceSeconds >= this.longSilenceSeconds;
    const randomPresetMode = this.repeatOnSettledVAD;
    const emotion = randomPresetMode ? this.randomVADPresetEmotion() : this.resolveSettledEmotion(vad, longSilence);
    const suggestedMessage = messageByEmotion[emotion] ?? messageByEmotion.neutral;
    const reason = randomPresetMode
      ? `repeat_vad_preset:${emotion}`
      : longSilence
      ? "long_idle"
      : `settled_idle:${emotion}`;

    this.currentEvent = {
      id: `${Math.round(timeSeconds * 1000)}-${emotion}`,
      emotion,
      intensity: randomPresetMode ? 0.74 : longSilence ? 0.7 : 0.62,
      silenceSeconds,
      suggestedMessage,
      systemPrompt: `用户已经 ${Math.round(silenceSeconds)} 秒没有主动说话。你当前情绪是 ${emotion}，VAD 强度约 ${vad.intensity.toFixed(2)}。请自然、简短地主动开口。`,
      reason,
      createdAt: timeSeconds
    };
    this.lastEventAt = timeSeconds;
    this.firedSinceInteraction = true;

    return this.currentEvent;
  }

  private isVADSettled(timeSeconds: number, vad: VADRuntimeState): boolean {
    const currentSettled = this.repeatOnSettledVAD
      ? vadAxesWithin(vad.current, this.repeatAxisThreshold)
      : vad.intensity <= this.settledIntensityThreshold;
    const targetSettled = this.repeatOnSettledVAD
      ? vadAxesWithin(vad.target, this.repeatAxisThreshold)
      : vadMagnitude(vad.target) <= this.targetSettledIntensityThreshold;
    const holdSettled = (vad.holdSeconds ?? 0) <= 0.25;

    if (!currentSettled || !targetSettled || !holdSettled) {
      this.settledSince = null;
      return false;
    }

    this.settledSince ??= timeSeconds;
    return timeSeconds - this.settledSince >= this.settledHoldSeconds;
  }

  private resolveSettledEmotion(vad: VADRuntimeState, longSilence: boolean): string {
    if (longSilence) return "curious";
    if (vad.current.valence > 0.035 && vad.current.dominance < -0.02) return "affectionate";
    if (vad.current.valence > 0.03) return "calm";
    if (vad.current.arousal > 0.03) return "curious";
    if (vad.current.valence < -0.03 || vad.current.dominance < -0.03) return "concerned";
    return "calm";
  }

  private randomVADPresetEmotion(): string {
    return repeatVADPresetEmotionPool[Math.floor(this.random() * repeatVADPresetEmotionPool.length)] ?? "curious";
  }
}

function vadMagnitude(vad: VADRuntimeState["target"]): number {
  return (
    Math.abs(vad.valence)
    + Math.abs(vad.arousal) * 0.82
    + Math.abs(vad.dominance) * 0.64
  ) / 2.46;
}

function vadAxesWithin(vad: VADRuntimeState["target"], threshold: number): boolean {
  return Math.abs(vad.valence) <= threshold
    && Math.abs(vad.arousal) <= threshold
    && Math.abs(vad.dominance) <= threshold;
}
