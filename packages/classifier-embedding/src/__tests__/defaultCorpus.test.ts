import { describe, expect, it } from "vitest";
import { emotionArchetypes } from "@soullink-emotion/engine/internal";
import { normalizeEmotionText } from "../EmbeddingMessageClassifier";
import {
  DEFAULT_EMOTION_CORPUS,
  DEFAULT_VAD_EMOTIONS
} from "../defaultCorpus";
import { DEFAULT_EMOTION_EXAMPLES } from "../defaultExamples";

describe("default emotion corpus", () => {
  it("contains 100 unique utterances for every canonical VAD emotion", () => {
    expect(DEFAULT_VAD_EMOTIONS).toHaveLength(14);

    const allTexts = DEFAULT_VAD_EMOTIONS.flatMap(emotion => {
      const texts = DEFAULT_EMOTION_CORPUS[emotion];
      expect(texts, emotion).toHaveLength(100);
      expect(new Set(texts).size, `${emotion} duplicates`).toBe(100);
      return [...texts];
    });

    expect(allTexts).toHaveLength(1_400);
    expect(new Set(allTexts).size).toBe(1_400);
    expect(new Set(allTexts.map(normalizeEmotionText)).size).toBe(1_400);
  });

  it("creates balanced, usable EmotionIntent examples", () => {
    expect(DEFAULT_EMOTION_EXAMPLES).toHaveLength(1_400);

    for (const emotion of DEFAULT_VAD_EMOTIONS) {
      const examples = DEFAULT_EMOTION_EXAMPLES.filter(example => example.intent.emotion === emotion);
      expect(examples, emotion).toHaveLength(100);
      expect(examples.every(example => Boolean(example.intent.variant))).toBe(true);
      expect(examples.every(example => example.intent.intensity >= 0 && example.intent.intensity <= 1)).toBe(true);
      expect(examples.every(example => example.intent.contextTags.length > 0)).toBe(true);
      expect(examples.every(example => {
        const variant = example.intent.variant;
        return Boolean(variant && emotionArchetypes[emotion]?.variants[variant]);
      }), `${emotion} variants`).toBe(true);
    }
  });

  it("covers unmasked and abbreviated rude chat", () => {
    const anger = DEFAULT_EMOTION_CORPUS.anger.join("\n");

    expect(anger).toContain("真他妈离谱");
    expect(anger).toContain("真是个傻逼");
    expect(anger).toContain("wdnmd这也能输");
    expect(anger).toContain("sb队友能不能别送了");

    const rude = DEFAULT_EMOTION_EXAMPLES.find(example => example.text === "真是个傻逼");
    expect(rude?.intent.contextTags).toEqual(expect.arrayContaining(["annoyed", "profanity", "abusive"]));
  });
});
