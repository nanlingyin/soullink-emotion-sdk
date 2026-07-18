import {
  clamp,
  type EmotionIntent,
  type PartialFACSActionUnitState,
  type PartialFACSLikeState,
  type VADVector,
  actionUnitKeys,
  facsKeys,
  getVADPreset,
  MessageReactionClassifier
} from "@soullink-emotion/engine";
import {
  isOpenAICompatibleClientLike,
  OpenAIClientNotConfiguredError,
  OpenAICompatibleClient
} from "./OpenAICompatibleClient";
import type {
  OpenAICompatibleClientLike,
  OpenAIClientOptions,
  OpenAIResponseFormat
} from "./openAICompatibleTypes";
import {
  buildSoullinkPlannerMessages,
  soullinkPlanResponseFormat,
  supportedContextTags,
  supportedEmotionVariants
} from "./soullinkPrompts";
import type { SoullinkActionBeat, SoullinkLLMPlan, SoullinkLLMPlanRequest } from "./SoullinkLLMTypes";

interface RawSoullinkPlan {
  emotion?: unknown;
  variant?: unknown;
  intensity?: unknown;
  contextTags?: unknown;
  context_tags?: unknown;
  replyDraft?: unknown;
  reply_draft?: unknown;
  reply?: unknown;
  vadTarget?: unknown;
  vad_target?: unknown;
  vad?: unknown;
  vadDelta?: unknown;
  vad_delta?: unknown;
  actionPlan?: unknown;
  action_plan?: unknown;
  actionBeats?: unknown;
  action_beats?: unknown;
}

const actionUnitAliases: Record<string, keyof PartialFACSActionUnitState> = {
  au1: "au01InnerBrowRaiser",
  au01: "au01InnerBrowRaiser",
  au2: "au02OuterBrowRaiser",
  au02: "au02OuterBrowRaiser",
  au4: "au04BrowLowerer",
  au04: "au04BrowLowerer",
  au5: "au05UpperLidRaiser",
  au05: "au05UpperLidRaiser",
  au6: "au06CheekRaiser",
  au06: "au06CheekRaiser",
  au7: "au07LidTightener",
  au07: "au07LidTightener",
  au9: "au09NoseWrinkler",
  au09: "au09NoseWrinkler",
  au10: "au10UpperLipRaiser",
  au12: "au12LipCornerPuller",
  au14: "au14Dimpler",
  au15: "au15LipCornerDepressor",
  au17: "au17ChinRaiser",
  au18: "au18LipPucker",
  au20: "au20LipStretcher",
  au23: "au23LipTightener",
  au24: "au24LipPressor",
  au25: "au25LipsPart",
  au26: "au26JawDrop",
  au27: "au27MouthStretch",
  au45: "au45Blink"
};

const knownFACSKeys = new Set<string>(facsKeys);
const knownActionUnitKeys = new Set<string>(actionUnitKeys);

export class SoullinkLLMPlanner {
  private classifier = new MessageReactionClassifier();
  private client: OpenAICompatibleClientLike;

  constructor(clientOrOptions: OpenAICompatibleClientLike | OpenAIClientOptions = {}) {
    this.client = isOpenAICompatibleClientLike(clientOrOptions)
      ? clientOrOptions
      : new OpenAICompatibleClient(clientOrOptions);
  }

  get config() {
    return this.client.config;
  }

  async plan(request: SoullinkLLMPlanRequest): Promise<SoullinkLLMPlan> {
    if (!this.client.isConfigured(request.openAI)) {
      return this.fallback(request);
    }

    let lastError: unknown;

    for (const responseFormat of this.responseFormatFallbacks()) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? request.openAI?.model,
          messages: buildSoullinkPlannerMessages(request),
          temperature: request.temperature ?? 0.35,
          max_tokens: 900,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }, request.openAI);
        const message = completion.choices[0]?.message;
        const raw = this.parseJSON(message?.content ?? "") as RawSoullinkPlan;
        const plan = this.sanitizePlan(raw, request);

        return {
          ...plan,
          provider: "openai-compatible",
          rawMessage: message
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) {
          return this.fallback(request);
        }
      }
    }

    console.warn(`Soullink LLM planner fell back: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    const plan = this.fallback(request);
    return {
      ...plan,
      replyDraft: plan.replyDraft || "我先按本地规则做一个反应。",
      provider: "fallback"
    };
  }

  private responseFormatFallbacks(): Array<OpenAIResponseFormat | undefined> {
    return [
      soullinkPlanResponseFormat,
      { type: "json_object" },
      undefined
    ];
  }

  private parseJSON(content: string): unknown {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("LLM returned empty content");

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");

      if (start >= 0 && end > start) {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      }

      throw new Error(`LLM did not return JSON: ${trimmed.slice(0, 160)}`);
    }
  }

  private fallback(request: SoullinkLLMPlanRequest): SoullinkLLMPlan {
    const intent = this.classifier.classify(request.message);
    const vadTarget = getVADPreset(intent.emotion, intent.variant);

    return {
      intent,
      replyDraft: this.createFallbackReply(intent),
      vadTarget,
      vadDelta: this.diffVAD(request.vad, vadTarget),
      actionPlan: this.createFallbackActionPlan(intent),
      provider: "fallback"
    };
  }

  private sanitizePlan(raw: RawSoullinkPlan, request: SoullinkLLMPlanRequest): Omit<SoullinkLLMPlan, "provider" | "rawMessage"> {
    const emotion = this.sanitizeEmotion(raw.emotion);
    const variant = this.sanitizeVariant(emotion, raw.variant);
    const intensity = clamp(this.toNumber(raw.intensity, 0.45), 0, 1);
    const contextTags = this.sanitizeContextTags(raw.contextTags ?? raw.context_tags);
    const vadTarget = this.sanitizeVAD(raw.vadTarget ?? raw.vad_target ?? raw.vad, getVADPreset(emotion, variant));
    const vadDelta = this.sanitizeVAD(raw.vadDelta ?? raw.vad_delta, this.diffVAD(request.vad, vadTarget));
    const intent = {
      emotion,
      variant,
      intensity,
      contextTags,
      sourceMessage: request.message
    };
    const actionPlan = this.sanitizeActionPlan(raw.actionPlan ?? raw.action_plan ?? raw.actionBeats ?? raw.action_beats);

    return {
      intent,
      replyDraft: this.stringOr(raw.replyDraft ?? raw.reply_draft ?? raw.reply, this.createFallbackReply(intent)),
      vadTarget,
      vadDelta,
      actionPlan: this.hasUsableActionPlan(actionPlan) ? actionPlan : this.createFallbackActionPlan(intent)
    };
  }

  private sanitizeEmotion(value: unknown): keyof typeof supportedEmotionVariants {
    return typeof value === "string" && value in supportedEmotionVariants
      ? value as keyof typeof supportedEmotionVariants
      : "neutral";
  }

  private sanitizeVariant(emotion: keyof typeof supportedEmotionVariants, value: unknown): string {
    const variants = supportedEmotionVariants[emotion];
    return typeof value === "string" && (variants as readonly string[]).includes(value)
      ? value
      : variants[0];
  }

  private sanitizeContextTags(value: unknown): string[] {
    if (!Array.isArray(value)) return ["normal_chat"];

    const tags = value
      .filter((item): item is string => typeof item === "string")
      .filter((item) => supportedContextTags.includes(item))
      .slice(0, 8);

    return tags.length ? tags : ["normal_chat"];
  }

  private sanitizeVAD(value: unknown, fallback: VADVector): VADVector {
    if (!value || typeof value !== "object") return fallback;
    const record = value as Record<string, unknown>;

    return {
      valence: clamp(this.toNumber(record.valence, fallback.valence), -1, 1),
      arousal: clamp(this.toNumber(record.arousal, fallback.arousal), -1, 1),
      dominance: clamp(this.toNumber(record.dominance, fallback.dominance), -1, 1)
    };
  }

  private sanitizeActionPlan(value: unknown): SoullinkActionBeat[] {
    if (!Array.isArray(value)) return [];

    return value
      .slice(0, 8)
      .map((item) => {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          time: clamp(this.toNumber(record.time, 0), 0, 8),
          duration: clamp(this.toNumber(record.duration, 0.4), 0.05, 4),
          label: String(record.label ?? "reaction"),
          intensity: clamp(this.toNumber(record.intensity, 0.4), 0, 1),
          facs: this.numericFACSRecord(record.facs),
          actionUnits: {
            ...this.numericActionUnitRecord(record.facs),
            ...this.numericActionUnitRecord(record.actionUnits)
          }
        };
      })
      .filter((beat) => {
        return Object.keys(beat.facs).length > 0 || Object.keys(beat.actionUnits).length > 0;
      });
  }

  private numericFACSRecord(value: unknown): PartialFACSLikeState {
    if (!value || typeof value !== "object") return {};
    const result: Record<string, number> = {};

    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (knownFACSKeys.has(key) && typeof raw === "number" && Number.isFinite(raw)) {
        result[key] = clamp(raw, -1, 1);
      }
    }

    return result as PartialFACSLikeState;
  }

  private numericActionUnitRecord(value: unknown): PartialFACSActionUnitState {
    if (!value || typeof value !== "object") return {};
    const result: Record<string, number> = {};

    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;

      const normalizedKey = this.normalizeActionUnitKey(key);
      if (normalizedKey) {
        result[normalizedKey] = clamp(raw, -1, 1);
      }
    }

    return result as PartialFACSActionUnitState;
  }

  private normalizeActionUnitKey(key: string): keyof PartialFACSActionUnitState | undefined {
    if (knownActionUnitKeys.has(key)) return key as keyof PartialFACSActionUnitState;
    return actionUnitAliases[key.replace(/[^a-zA-Z0-9]/gu, "").toLowerCase()];
  }

  private hasUsableActionPlan(actionPlan: SoullinkActionBeat[]): boolean {
    return actionPlan.some((beat) => {
      return Object.keys(beat.facs ?? {}).length > 0 || Object.keys(beat.actionUnits ?? {}).length > 0;
    });
  }

  private stringOr(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  private diffVAD(from: VADVector | undefined, to: VADVector): VADVector {
    const current = from ?? { valence: 0, arousal: 0, dominance: 0 };
    return {
      valence: clamp(to.valence - current.valence, -1, 1),
      arousal: clamp(to.arousal - current.arousal, -1, 1),
      dominance: clamp(to.dominance - current.dominance, -1, 1)
    };
  }

  private createFallbackReply(intent: EmotionIntent): string {
    if (intent.emotion === "excited") return "哇，这个真的很让人兴奋，我眼睛都亮起来了。";
    if (intent.emotion === "happy") return "这也太好了吧，我真心替你开心。";
    if (intent.emotion === "shy") return "唔，被你这样说，我会有点不好意思的。";
    if (intent.emotion === "affectionate") return "嗯，我在这里，轻轻陪你一会儿。";
    if (intent.emotion === "curious") return "我有点好奇，想听你多说一点。";
    if (intent.emotion === "concerned") return "我在听，你可以慢慢说。";
    if (intent.emotion === "confused") return "嗯，我先陪你把它拆小一点，别急。";
    if (intent.emotion === "tired") return "听起来你真的累了，先缓一口气也没关系。";
    if (intent.emotion === "sad") return "我听见了，这种难过先不用急着藏起来。";
    if (intent.emotion === "anxiety") return "先别急，我陪你把眼前这一步看清楚。";
    if (intent.emotion === "anger" || intent.emotion === "angry") return "这确实会让人很不舒服，你生气是有原因的。";
    if (intent.emotion === "surprised") return "诶，真的假的？";
    return "嗯，我在。";
  }

  private createFallbackActionPlan(intent: EmotionIntent): SoullinkActionBeat[] {
    const intensity = clamp(intent.intensity, 0.2, 1);

    if (intent.emotion === "happy" || intent.emotion === "excited") {
      return [
        {
          time: 0.05,
          duration: 0.46,
          label: "brighten",
          intensity,
          actionUnits: {
            au05UpperLidRaiser: 0.28,
            au12LipCornerPuller: 0.72,
            au25LipsPart: intent.emotion === "excited" ? 0.34 : 0.16,
            headY: -0.08
          }
        },
        {
          time: 0.5,
          duration: 0.52,
          label: "settle-smile",
          intensity: intensity * 0.72,
          facs: {
            mouthSmile: 0.42,
            eyeSmile: 0.24,
            headZ: 0.04
          }
        }
      ];
    }

    if (intent.emotion === "shy") {
      return [
        {
          time: 0.08,
          duration: 0.72,
          label: "avert-gaze",
          intensity,
          actionUnits: {
            au06CheekRaiser: 0.36,
            au12LipCornerPuller: 0.48,
            gazeX: -0.32,
            gazeY: -0.16,
            headZ: -0.12,
            blush: 0.72
          }
        }
      ];
    }

    if (intent.emotion === "concerned" || intent.emotion === "sad" || intent.emotion === "anxiety") {
      return [
        {
          time: 0.05,
          duration: 0.68,
          label: "soft-concern",
          intensity,
          actionUnits: {
            au01InnerBrowRaiser: intent.emotion === "sad" ? 0.58 : 0.42,
            au15LipCornerDepressor: intent.emotion === "sad" ? 0.34 : 0.14,
            au05UpperLidRaiser: intent.emotion === "anxiety" ? 0.3 : 0,
            sweat: intent.emotion === "anxiety" ? 0.32 : 0,
            gazeY: -0.08
          }
        }
      ];
    }

    if (intent.emotion === "curious" || intent.emotion === "confused") {
      return [
        {
          time: 0.04,
          duration: 0.58,
          label: "question-tilt",
          intensity,
          actionUnits: {
            au01InnerBrowRaiser: 0.2,
            au02OuterBrowRaiser: 0.26,
            au25LipsPart: 0.12,
            headZ: 0.16
          }
        }
      ];
    }

    if (intent.emotion === "anger" || intent.emotion === "angry") {
      return [
        {
          time: 0.03,
          duration: 0.58,
          label: "firm-frown",
          intensity,
          actionUnits: {
            au04BrowLowerer: 0.52,
            au07LidTightener: 0.24,
            au15LipCornerDepressor: 0.34,
            headY: 0.06
          }
        }
      ];
    }

    return [
      {
        time: 0.08,
        duration: 0.42,
        label: "attentive-nod",
        intensity: intensity * 0.55,
        facs: {
          browInnerUp: 0.08,
          mouthSmile: 0.12,
          headY: -0.04
        }
      }
    ];
  }

  private toNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
}
