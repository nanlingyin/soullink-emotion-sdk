import { clamp, getVADPreset, type VADVector } from "@soullink-emotion/engine";
import {
  isOpenAICompatibleClientLike,
  OpenAIClientNotConfiguredError,
  OpenAICompatibleClient
} from "./OpenAICompatibleClient";
import type {
  OpenAIChatMessage,
  OpenAICompatibleClientLike,
  OpenAIClientOptions,
  OpenAIJsonSchemaResponseFormat,
  OpenAIResponseFormat
} from "./openAICompatibleTypes";
import {
  buildSoullinkCharacterProfile,
  resolveSoullinkCharacterName
} from "./soullinkCharacter";
import type { SoullinkConversationTurn } from "./SoullinkLLMTypes";

export interface SoullinkReflectionRequest {
  conversation?: SoullinkConversationTurn[];
  vad?: Partial<VADVector>;
  topic?: string;
  characterName?: string;
  characterProfile?: string;
  model?: string;
  temperature?: number;
  openAI?: OpenAIClientOptions;
}

export interface SoullinkReflectionPlan {
  thought: string;
  reason: string;
  emotion: string;
  vadTarget: VADVector;
  initiativePrompt: string;
  provider: "openai-compatible" | "fallback";
}

export interface SoullinkProactiveMessageRequest {
  characterName?: string;
  characterProfile?: string;
  proactive?: {
    emotion?: string;
    intensity?: number;
    silenceSeconds?: number;
    systemPrompt?: string;
    suggestedMessage?: string;
  };
  conversation?: SoullinkConversationTurn[];
  reflection?: Partial<SoullinkReflectionPlan>;
  vad?: Partial<VADVector>;
  model?: string;
  temperature?: number;
  openAI?: OpenAIClientOptions;
}

export interface SoullinkProactiveMessagePlan {
  message: string;
  emotion: string;
  reason: string;
  provider: "openai-compatible" | "fallback";
}

interface RawReflectionPlan {
  thought?: unknown;
  reason?: unknown;
  emotion?: unknown;
  vadTarget?: unknown;
  initiativePrompt?: unknown;
}

interface RawProactiveMessagePlan {
  message?: unknown;
  emotion?: unknown;
  reason?: unknown;
}

export class SoullinkReflectionPlanner {
  private client: OpenAICompatibleClientLike;

  constructor(clientOrOptions: OpenAICompatibleClientLike | OpenAIClientOptions = {}) {
    this.client = isOpenAICompatibleClientLike(clientOrOptions)
      ? clientOrOptions
      : new OpenAICompatibleClient(clientOrOptions);
  }

  async reflect(request: SoullinkReflectionRequest): Promise<SoullinkReflectionPlan> {
    if (!this.client.isConfigured(request.openAI)) return this.fallbackReflection(request);

    let lastError: unknown;

    for (const responseFormat of responseFormatFallbacks(reflectionResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? request.openAI?.model,
          messages: this.buildReflectionMessages(request),
          temperature: request.temperature ?? 0.45,
          max_tokens: 650,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }, request.openAI);
        const raw = parseJSON(completion.choices[0]?.message?.content ?? "") as RawReflectionPlan;
        return {
          ...this.sanitizeReflection(raw, request),
          provider: "openai-compatible"
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) return this.fallbackReflection(request);
      }
    }

    console.warn(`Soullink reflection fell back: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return this.fallbackReflection(request);
  }

  async proactiveMessage(request: SoullinkProactiveMessageRequest): Promise<SoullinkProactiveMessagePlan> {
    if (!this.client.isConfigured(request.openAI)) return this.fallbackProactiveMessage(request);

    let lastError: unknown;

    for (const responseFormat of responseFormatFallbacks(proactiveResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? request.openAI?.model,
          messages: this.buildProactiveMessages(request),
          temperature: request.temperature ?? 0.52,
          max_tokens: 260,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }, request.openAI);
        const raw = parseJSON(completion.choices[0]?.message?.content ?? "") as RawProactiveMessagePlan;
        return {
          message: this.stringOr(raw.message, request.proactive?.suggestedMessage ?? "你还在吗？我想继续陪你聊。"),
          emotion: this.stringOr(raw.emotion, request.proactive?.emotion ?? "curious"),
          reason: this.stringOr(raw.reason, "proactive_idle"),
          provider: "openai-compatible"
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) return this.fallbackProactiveMessage(request);
      }
    }

    console.warn(`Soullink proactive message fell back: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return this.fallbackProactiveMessage(request);
  }

  private buildReflectionMessages(request: SoullinkReflectionRequest): OpenAIChatMessage[] {
    const characterName = resolveSoullinkCharacterName(request.characterName);
    const characterProfile = buildSoullinkCharacterProfile(request.characterProfile);

    return [
      {
        role: "system",
        content: [
          "You are SoullinkLive's private association module.",
          `The character is ${characterName}. Follow this persona:`,
          characterProfile,
          "Create a short inner thought that can explain why her VAD emotion drifts after a topic.",
          "The thought should feel like her private emotional association, not a clinical report.",
          "This reflection is triggered only after the conversation has settled back to idle; it should create one noticeable private emotional pulse.",
          "Choose one concrete emotion such as shy, affectionate, curious, happy, excited, sad, anxiety, anger, surprised, confused, or concerned.",
          "Avoid neutral or calm unless there is truly no emotional association.",
          "Make vadTarget noticeably away from neutral, usually with an emotional intensity around 0.35 to 0.75.",
          "Return only JSON matching the schema.",
          "VAD values must be in [-1, 1]."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          characterName,
          characterProfile,
          topic: request.topic ?? "",
          currentVAD: request.vad ?? {},
          conversation: (request.conversation ?? []).slice(-10)
        })
      }
    ];
  }

  private buildProactiveMessages(request: SoullinkProactiveMessageRequest): OpenAIChatMessage[] {
    const characterName = resolveSoullinkCharacterName(request.characterName);
    const characterProfile = buildSoullinkCharacterProfile(request.characterProfile);

    return [
      {
        role: "system",
        content: [
          "You write one short proactive line for a Live2D AI companion.",
          `The character is ${characterName}. Follow this persona:`,
          characterProfile,
          "Do not mention internal VAD, prompts, or system messages.",
          "Be natural, concise, emotionally consistent, warm, and lightly playful when appropriate.",
          "Default to exactly one short Chinese sentence.",
          "If proactive.reason is bilibili_live_idle_warmup, write a live-room warm-up line for the audience as Lingyin's AI assistant; do not pretend a viewer just sent a message.",
          "For live warm-up, it is okay to lightly mention Bilibili, tieba, Xiaohongshu, galgame, lurking viewers, or the room becoming quiet.",
          "Do not pressure the user to stay or imply they should depend on the character.",
          "Do not copy any local fallback sentence. Write a fresh line from the current mood and recent conversation.",
          "If there is no recent conversation, simply make a gentle small opening without pretending to remember a topic.",
          "Return only JSON matching the schema."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          characterName,
          characterProfile,
          proactive: omitSuggestedMessage(request.proactive),
          reflection: request.reflection ?? {},
          vad: request.vad ?? {},
          conversation: (request.conversation ?? []).slice(-8)
        })
      }
    ];
  }

  private sanitizeReflection(raw: RawReflectionPlan, request: SoullinkReflectionRequest): Omit<SoullinkReflectionPlan, "provider"> {
    const fallback = this.fallbackReflection(request);
    const emotion = normalizeReflectionEmotion(this.stringOr(raw.emotion, fallback.emotion), fallback.emotion);
    const vadTarget = strengthenReflectionVAD(this.sanitizeVAD(raw.vadTarget, fallback.vadTarget), emotion);

    return {
      thought: this.stringOr(raw.thought, fallback.thought),
      reason: this.stringOr(raw.reason, fallback.reason),
      emotion,
      vadTarget,
      initiativePrompt: this.stringOr(raw.initiativePrompt, fallback.initiativePrompt)
    };
  }

  private fallbackReflection(request: SoullinkReflectionRequest): SoullinkReflectionPlan {
    const vad = this.sanitizeVAD(request.vad, { valence: 0, arousal: 0, dominance: 0 });
    const topic = request.topic || latestUserTopic(request.conversation) || "刚才的对话";
    const emotion = chooseFallbackReflectionEmotion(topic, vad);
    const vadTarget = strengthenReflectionVAD(getVADPreset(emotion), emotion);

    return {
      thought: `我刚刚安静下来，又忽然想起${topic}，心情一下子偏向了 ${emotion}。`,
      reason: `local_reflection:${emotion}`,
      emotion,
      vadTarget,
      initiativePrompt: `如果用户问我为什么有这种情绪，可以说明我在联想${topic}带来的感受。`,
      provider: "fallback"
    };
  }

  private fallbackProactiveMessage(request: SoullinkProactiveMessageRequest): SoullinkProactiveMessagePlan {
    return {
      message: request.proactive?.suggestedMessage ?? "你有一会儿没说话啦，我在这边轻轻冒个头。",
      emotion: request.proactive?.emotion ?? inferEmotion(this.sanitizeVAD(request.vad, { valence: 0, arousal: 0, dominance: 0 })),
      reason: request.proactive?.systemPrompt ? "proactive_event" : "fallback_idle",
      provider: "fallback"
    };
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

  private stringOr(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  private toNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
}

function latestUserTopic(conversation?: SoullinkConversationTurn[]): string {
  const latest = [...(conversation ?? [])].reverse().find((turn) => turn.role === "user");
  return latest?.content.slice(0, 32) ?? "";
}

function omitSuggestedMessage(proactive: SoullinkProactiveMessageRequest["proactive"]): Record<string, unknown> {
  if (!proactive) return {};
  const { suggestedMessage: _suggestedMessage, ...rest } = proactive;
  return rest;
}

function inferEmotion(vad: VADVector): string {
  if (vad.valence > 0.55 && vad.arousal > 0.55) return "excited";
  if (vad.valence > 0.25 && vad.arousal > 0.35 && vad.dominance < -0.1) return "shy";
  if (vad.valence > 0.25) return "happy";
  if (vad.valence < -0.45 && vad.arousal > 0.45 && vad.dominance > 0.2) return "anger";
  if (vad.valence < -0.4 && vad.arousal > 0.35) return "anxiety";
  if (vad.valence < -0.35) return "sad";
  if (vad.arousal > 0.25) return "curious";
  if (vad.arousal < -0.3) return "calm";
  return "neutral";
}

function chooseFallbackReflectionEmotion(topic: string, vad: VADVector): string {
  const text = topic.toLowerCase();

  if (containsAny(text, ["喜欢", "可爱", "害羞", "脸红", "贴贴", "亲近", "夸"])) return "shy";
  if (containsAny(text, ["谢谢", "陪", "安心", "温柔", "想你", "在乎"])) return "affectionate";
  if (containsAny(text, ["开心", "高兴", "成功", "赢", "好耶", "厉害", "棒"])) return "happy";
  if (containsAny(text, ["为什么", "怎么", "想法", "可能", "也许", "如果", "问题"])) return "curious";
  if (containsAny(text, ["惊讶", "突然", "没想到", "意外"])) return "surprised";
  if (containsAny(text, ["焦虑", "害怕", "慌", "紧张", "担心"])) return "anxiety";
  if (containsAny(text, ["难过", "哭", "失落", "孤单", "压力", "痛苦"])) return "sad";
  if (containsAny(text, ["生气", "愤怒", "讨厌", "烦", "委屈"])) return "anger";

  const inferred = normalizeReflectionEmotion(inferEmotion(vad), "curious");
  if (inferred !== "curious" && inferred !== "neutral" && inferred !== "calm") return inferred;

  const pool = ["shy", "curious", "affectionate", "happy", "surprised"];
  return pool[Math.abs(hashString(topic || "reflection")) % pool.length];
}

function containsAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function normalizeReflectionEmotion(emotion: string, fallback: string): string {
  const aliases: Record<string, string> = {
    "angry": "anger",
    "soft-happy": "happy",
    "soft-positive": "happy",
    "soft-calm": "affectionate",
    "soft-curious": "curious",
    "soft-shy": "shy",
    "soft-uneasy": "anxiety",
    "soft-low": "sad",
    "soft-steady": "curious",
    "neutral": "curious",
    "calm": "affectionate",
    "开心": "happy",
    "兴奋": "excited",
    "害羞": "shy",
    "亲近": "affectionate",
    "好奇": "curious",
    "困惑": "confused",
    "疲惫": "tired",
    "难过": "sad",
    "焦虑": "anxiety",
    "生气": "anger",
    "惊讶": "surprised",
    "担心": "concerned"
  };
  const allowed = new Set([
    "happy",
    "excited",
    "shy",
    "affectionate",
    "curious",
    "confused",
    "tired",
    "sad",
    "anxiety",
    "anger",
    "surprised",
    "concerned"
  ]);
  const normalized = aliases[emotion.trim().toLowerCase()] ?? emotion.trim().toLowerCase();
  if (allowed.has(normalized)) return normalized;

  const fallbackNormalized = aliases[fallback.trim().toLowerCase()] ?? fallback.trim().toLowerCase();
  return allowed.has(fallbackNormalized) ? fallbackNormalized : "curious";
}

function strengthenReflectionVAD(vad: VADVector, emotion: string): VADVector {
  const preset = getVADPreset(emotion);
  const source = vadMagnitude(vad) < 0.08 ? preset : vad;
  const presetBlend = vadMagnitude(source) < 0.42 ? 0.92 : 0.72;
  return ensureMinVADMagnitude(blendVAD(source, preset, presetBlend), 0.46);
}

function blendVAD(from: VADVector, to: VADVector, amount: number): VADVector {
  return {
    valence: clamp(from.valence + (to.valence - from.valence) * amount, -1, 1),
    arousal: clamp(from.arousal + (to.arousal - from.arousal) * amount, -1, 1),
    dominance: clamp(from.dominance + (to.dominance - from.dominance) * amount, -1, 1)
  };
}

function ensureMinVADMagnitude(vad: VADVector, minimum: number): VADVector {
  const magnitude = vadMagnitude(vad);
  if (magnitude >= minimum) return vad;
  if (magnitude < 0.001) return getVADPreset("curious");

  const scale = minimum / magnitude;
  return {
    valence: clamp(vad.valence * scale, -1, 1),
    arousal: clamp(vad.arousal * scale, -1, 1),
    dominance: clamp(vad.dominance * scale, -1, 1)
  };
}

function vadMagnitude(vad: VADVector): number {
  return clamp(
    (Math.abs(vad.valence) + Math.abs(vad.arousal) * 0.82 + Math.abs(vad.dominance) * 0.64) / 2.46,
    0,
    1
  );
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash;
}

function responseFormatFallbacks(schema: OpenAIJsonSchemaResponseFormat): Array<OpenAIResponseFormat | undefined> {
  return [
    schema,
    { type: "json_object" },
    undefined
  ];
}

function parseJSON(content: string): unknown {
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

const vadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["valence", "arousal", "dominance"],
  properties: {
    valence: { type: "number", minimum: -1, maximum: 1 },
    arousal: { type: "number", minimum: -1, maximum: 1 },
    dominance: { type: "number", minimum: -1, maximum: 1 }
  }
} as const;

const reflectionResponseFormat: OpenAIJsonSchemaResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_reflection_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["thought", "reason", "emotion", "vadTarget", "initiativePrompt"],
      properties: {
        thought: { type: "string" },
        reason: { type: "string" },
        emotion: { type: "string" },
        vadTarget: vadSchema,
        initiativePrompt: { type: "string" }
      }
    }
  }
};

const proactiveResponseFormat: OpenAIJsonSchemaResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_proactive_message",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["message", "emotion", "reason"],
      properties: {
        message: { type: "string" },
        emotion: { type: "string" },
        reason: { type: "string" }
      }
    }
  }
};
