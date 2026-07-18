import { DEFAULT_EMOTION_CORPUS, DEFAULT_VAD_EMOTIONS, type DefaultVADEmotion } from "./defaultCorpus";
import type { EmotionExampleInput } from "./types";

interface EmotionExampleDefaults {
  variants: readonly string[];
  intensity: readonly [min: number, max: number];
  contextTags: readonly string[];
}

const EMOTION_EXAMPLE_DEFAULTS: Readonly<Record<DefaultVADEmotion, EmotionExampleDefaults>> = {
  neutral: {
    variants: ["neutral_ack", "attentive"],
    intensity: [0.22, 0.4],
    contextTags: ["normal_chat"]
  },
  calm: {
    variants: ["soft_calm", "quiet_listen"],
    intensity: [0.35, 0.6],
    contextTags: ["calm"]
  },
  happy: {
    variants: ["soft_smile", "bright_smile", "surprised_happy"],
    intensity: [0.58, 0.86],
    contextTags: ["user_good_news"]
  },
  excited: {
    variants: ["sparkle", "bounce"],
    intensity: [0.72, 0.95],
    contextTags: ["user_good_news"]
  },
  shy: {
    variants: ["bashful", "embarrassed"],
    intensity: [0.58, 0.86],
    contextTags: ["compliment", "warm"]
  },
  affectionate: {
    variants: ["warm", "close"],
    intensity: [0.55, 0.82],
    contextTags: ["warm"]
  },
  curious: {
    variants: ["tilt", "attentive_question"],
    intensity: [0.48, 0.76],
    contextTags: ["question", "curious"]
  },
  concerned: {
    variants: ["soft_concern", "worried", "comfort"],
    intensity: [0.55, 0.82],
    contextTags: ["comfort"]
  },
  confused: {
    variants: ["confused"],
    intensity: [0.48, 0.76],
    contextTags: ["question"]
  },
  surprised: {
    variants: ["startled"],
    intensity: [0.58, 0.9],
    contextTags: ["normal_chat"]
  },
  tired: {
    variants: ["drained", "sleepy"],
    intensity: [0.5, 0.85],
    contextTags: ["user_tired"]
  },
  sad: {
    variants: ["downcast", "teary"],
    intensity: [0.55, 0.9],
    contextTags: ["comfort"]
  },
  anxiety: {
    variants: ["uneasy", "nervous"],
    intensity: [0.55, 0.92],
    contextTags: ["comfort"]
  },
  anger: {
    variants: ["annoyed", "firm"],
    intensity: [0.5, 0.95],
    contextTags: ["annoyed"]
  }
};

const PROFANITY_PATTERN = /(他妈|妈的|我靠|艹|老子|去你妈|傻逼|脑残|弱智|王八蛋|狗东西|\bwdnmd\b|\bnmsl\b|\bcnm\b|\bmd\b|\btm\b|\bsb\b)/iu;
const ABUSIVE_PATTERN = /(有病|脑子进水|不会说人话|算什么东西|欠骂|滚一边|闭上.*嘴|傻x|蠢货|垃圾.*滚蛋)/iu;

function interpolateIntensity(
  index: number,
  count: number,
  range: readonly [number, number]
): number {
  if (count <= 1) return range[0];
  const value = range[0] + (range[1] - range[0]) * index / (count - 1);
  return Math.round(value * 100) / 100;
}

function selectVariant(index: number, count: number, variants: readonly string[]): string {
  const variantIndex = Math.min(
    variants.length - 1,
    Math.floor(index * variants.length / count)
  );
  return variants[variantIndex];
}

function contextTagsFor(
  emotion: DefaultVADEmotion,
  text: string,
  defaults: readonly string[]
): string[] {
  const tags = [...defaults];
  if (emotion !== "anger") return tags;
  if (PROFANITY_PATTERN.test(text)) tags.push("profanity");
  if (tags.includes("profanity") || ABUSIVE_PATTERN.test(text)) tags.push("abusive");
  return tags;
}

export const DEFAULT_EMOTION_EXAMPLES: readonly EmotionExampleInput[] = DEFAULT_VAD_EMOTIONS.flatMap(
  (emotion) => {
    const texts = DEFAULT_EMOTION_CORPUS[emotion];
    const defaults = EMOTION_EXAMPLE_DEFAULTS[emotion];

    return texts.map((text, index) => ({
      text,
      intent: {
        emotion,
        variant: selectVariant(index, texts.length, defaults.variants),
        intensity: interpolateIntensity(index, texts.length, defaults.intensity),
        contextTags: contextTagsFor(emotion, text, defaults.contextTags)
      }
    }));
  }
);
