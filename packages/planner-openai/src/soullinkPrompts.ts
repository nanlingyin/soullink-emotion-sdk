import type { OpenAIChatMessage, OpenAIJsonSchemaResponseFormat } from "./openAICompatibleTypes";
import {
  buildSoullinkCharacterProfile,
  resolveSoullinkCharacterName
} from "./soullinkCharacter";
import type { SoullinkLLMPlanRequest } from "./SoullinkLLMTypes";

export const supportedEmotionVariants = {
  neutral: ["neutral_ack", "attentive"],
  calm: ["soft_calm", "quiet_listen"],
  happy: ["soft_smile", "bright_smile", "surprised_happy", "shy_happy"],
  excited: ["sparkle", "bounce"],
  shy: ["bashful", "embarrassed"],
  affectionate: ["warm", "close"],
  curious: ["tilt", "attentive_question"],
  concerned: ["soft_concern", "worried", "comfort"],
  confused: ["confused"],
  surprised: ["startled"],
  tired: ["sleepy", "drained"],
  sad: ["downcast", "teary"],
  anxiety: ["nervous", "uneasy"],
  anger: ["annoyed", "firm"],
  angry: ["annoyed", "firm"]
} as const;

export const supportedContextTags = [
  "normal_chat",
  "user_good_news",
  "compliment",
  "warm",
  "user_tired",
  "question",
  "annoyed",
  "curious",
  "shy",
  "comfort",
  "proactive_idle",
  "reflection",
  "voice"
];

export function buildSoullinkPlannerMessages(request: SoullinkLLMPlanRequest): OpenAIChatMessage[] {
  const history = (request.conversation ?? []).slice(-8);
  const characterName = resolveSoullinkCharacterName(request.characterName);
  const characterProfile = buildSoullinkCharacterProfile(request.characterProfile);
  const currentVAD = request.vad
    ? `Current VAD: valence=${request.vad.valence}, arousal=${request.vad.arousal}, dominance=${request.vad.dominance}.`
    : "Current VAD is unknown.";

  return [
    {
      role: "system",
      content: [
        "You are SoullinkLive's reaction planner for a Live2D character.",
        `The character is ${characterName}. Follow this persona as the highest-priority character style:`,
        characterProfile,
        "Return only JSON that matches the schema.",
        "Do not output Live2D ParamXXX values.",
        "Plan high-level emotional intent, VAD target, and optional FACS/AU action beats.",
        "replyDraft must be one short natural Chinese sentence from the character to the user by default.",
        "Only write a little more when the character is genuinely interested in the user or topic.",
        "replyDraft must not mention being an AI, prompts, JSON, VAD, FACS, or internal planning.",
        "Avoid frequent parenthesized action narration; usually just speak directly.",
        "When the user is sad, anxious, tired, or angry, acknowledge the feeling before advice.",
        "When the user is confused, split the response into a small next step when possible.",
        "When the user is happy, share the happiness sincerely.",
        `Supported emotions and variants: ${JSON.stringify(supportedEmotionVariants)}.`,
        `Supported context tags: ${supportedContextTags.join(", ")}.`,
        "Intensity values must be between 0 and 1.",
        "VAD values must be between -1 and 1.",
        "Action beats are optional, short, and relative to the reaction start in seconds."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName,
        characterProfile,
        currentVAD,
        conversation: history,
        userMessage: request.message
      })
    }
  ];
}

export const soullinkPlanResponseFormat: OpenAIJsonSchemaResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_reaction_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["emotion", "variant", "intensity", "contextTags", "replyDraft", "vadTarget", "vadDelta", "actionPlan"],
      properties: {
        emotion: {
          type: "string",
          enum: Object.keys(supportedEmotionVariants)
        },
        variant: {
          type: "string"
        },
        intensity: {
          type: "number",
          minimum: 0,
          maximum: 1
        },
        contextTags: {
          type: "array",
          items: {
            type: "string"
          }
        },
        replyDraft: {
          type: "string"
        },
        vadTarget: {
          type: "object",
          additionalProperties: false,
          required: ["valence", "arousal", "dominance"],
          properties: {
            valence: { type: "number", minimum: -1, maximum: 1 },
            arousal: { type: "number", minimum: -1, maximum: 1 },
            dominance: { type: "number", minimum: -1, maximum: 1 }
          }
        },
        vadDelta: {
          type: "object",
          additionalProperties: false,
          required: ["valence", "arousal", "dominance"],
          properties: {
            valence: { type: "number", minimum: -1, maximum: 1 },
            arousal: { type: "number", minimum: -1, maximum: 1 },
            dominance: { type: "number", minimum: -1, maximum: 1 }
          }
        },
        actionPlan: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["time", "duration", "label", "intensity", "facs", "actionUnits"],
            properties: {
              time: { type: "number", minimum: 0, maximum: 8 },
              duration: { type: "number", minimum: 0.05, maximum: 4 },
              label: { type: "string" },
              intensity: { type: "number", minimum: 0, maximum: 1 },
              facs: {
                type: "object",
                additionalProperties: { type: "number" }
              },
              actionUnits: {
                type: "object",
                additionalProperties: { type: "number" }
              }
            }
          }
        }
      }
    }
  }
};

