import { describe, expect, it, vi } from "vitest";
import { EmbeddingMessageClassifier } from "../EmbeddingMessageClassifier";
import type {
  EmbeddingProvider,
  EmbeddingVectorCache,
  EmbeddingVectorCacheEntry,
  EmotionExampleInput
} from "../types";

interface TestOptions {
  tenant?: string;
}

function example(
  text: string,
  emotion: string,
  embedding?: number[]
): EmotionExampleInput {
  return {
    text,
    embedding,
    intent: {
      emotion,
      variant: `${emotion}_variant`,
      intensity: 0.8,
      contextTags: [emotion]
    }
  };
}

function createProvider(vectors: Record<string, number[]>) {
  const provider: EmbeddingProvider<TestOptions> = {
    isConfigured: vi.fn(() => true),
    embed: vi.fn(async (text: string) => vectors[text] ?? [0, 0]),
    batchEmbed: vi.fn(async (texts: string[]) => texts.map(text => vectors[text]))
  };
  return provider;
}

describe("EmbeddingMessageClassifier", () => {
  it("classifies with any EmbeddingProvider and returns EmotionIntent", async () => {
    const provider = createProvider({
      开心样本: [1, 0],
      难过样本: [0, 1],
      今天真不错: [0.98, 0.02]
    });
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      examples: [example("开心样本", "happy"), example("难过样本", "sad")]
    });

    await classifier.initialize({ tenant: "demo" });
    const intent = await classifier.classify("今天真不错", { tenant: "demo" });

    expect(intent).toEqual({
      emotion: "happy",
      variant: "happy_variant",
      intensity: 0.8,
      contextTags: ["happy"],
      naturalVAD: { valence: 0.75, arousal: 0.45, dominance: 0.35 },
      sourceMessage: "今天真不错"
    });
    expect(classifier.isInitialized).toBe(true);
    expect(provider.batchEmbed).toHaveBeenCalledWith(
      ["开心样本", "难过样本"],
      { tenant: "demo" }
    );
  });

  it("adds dynamic examples and embeds only the new samples", async () => {
    const provider = createProvider({
      初始样本: [1, 0],
      新增样本: [0, 1],
      查询: [0, 1]
    });
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      examples: [example("初始样本", "neutral")]
    });

    await classifier.initialize();
    classifier.addExample("新增样本", {
      emotion: "confused",
      variant: "confused",
      intensity: 0.7,
      contextTags: ["question"]
    });
    expect(classifier.isInitialized).toBe(false);

    await classifier.initialize();
    expect(provider.batchEmbed).toHaveBeenNthCalledWith(1, ["初始样本"], undefined);
    expect(provider.batchEmbed).toHaveBeenNthCalledWith(2, ["新增样本"], undefined);
    await expect(classifier.classify("查询")).resolves.toMatchObject({
      emotion: "confused",
      sourceMessage: "查询"
    });
  });

  it("initializes large corpora in provider-sized batches", async () => {
    const provider: EmbeddingProvider = {
      embed: vi.fn(async () => [1, 0]),
      batchEmbed: vi.fn(async (texts: string[]) => texts.map((_, index) => [1, index + 1]))
    };
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      initializationBatchSize: 2,
      examples: [
        example("样本一", "neutral"),
        example("样本二", "happy"),
        example("样本三", "sad"),
        example("样本四", "anger"),
        example("样本五", "calm")
      ]
    });

    await classifier.initialize();

    expect(provider.batchEmbed).toHaveBeenCalledTimes(3);
    expect(provider.batchEmbed).toHaveBeenNthCalledWith(1, ["样本一", "样本二"], undefined);
    expect(provider.batchEmbed).toHaveBeenNthCalledWith(2, ["样本三", "样本四"], undefined);
    expect(provider.batchEmbed).toHaveBeenNthCalledWith(3, ["样本五"], undefined);
    expect(classifier.isInitialized).toBe(true);
  });

  it("uses the compatible Chinese rule fallback when not configured", async () => {
    const provider: EmbeddingProvider = {
      isConfigured: () => false,
      embed: vi.fn(),
      batchEmbed: vi.fn()
    };
    const classifier = new EmbeddingMessageClassifier(provider);

    await classifier.initialize();
    await expect(classifier.classify("  我考试通过了  ")).resolves.toEqual({
      emotion: "happy",
      variant: "surprised_happy",
      intensity: 0.85,
      contextTags: ["user_good_news"],
      naturalVAD: { valence: 0.75, arousal: 0.45, dominance: 0.35 },
      sourceMessage: "我考试通过了"
    });
    expect(classifier.exampleCount).toBe(1_400);
    expect(provider.batchEmbed).not.toHaveBeenCalled();
  });

  it("returns neutral when the best similarity does not clear the threshold", async () => {
    const provider = createProvider({ sample: [1, 0], query: [0, 1] });
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      examples: [example("sample", "happy")],
      similarityThreshold: 0.65
    });

    await classifier.initialize();
    await expect(classifier.classify("query")).resolves.toEqual({
      emotion: "neutral",
      variant: "neutral_ack",
      intensity: 0.35,
      contextTags: ["normal_chat"],
      naturalVAD: { valence: 0, arousal: 0, dominance: 0 },
      sourceMessage: "query"
    });
  });

  it("uses weighted top-k voting and returns continuous VAD details", async () => {
    const vector = (similarity: number) => [similarity, Math.sqrt(1 - similarity * similarity)];
    const provider = createProvider({
      happy: vector(0.92),
      sad1: vector(0.9),
      sad2: vector(0.89),
      sad3: vector(0.88),
      neutral: vector(0.1),
      query: [1, 0]
    });
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      topK: 5,
      similarityThreshold: 0.65,
      examples: [
        example("happy", "happy"),
        example("sad1", "sad"),
        example("sad2", "sad"),
        example("sad3", "sad"),
        example("neutral", "neutral")
      ]
    });

    await classifier.initialize();
    const detail = await classifier.classifyDetailed("query");

    expect(detail.source).toBe("embedding");
    expect(detail.intent.emotion).toBe("sad");
    expect(detail.emotionScores[0]).toMatchObject({ emotion: "sad" });
    expect(detail.matchedExamples).toHaveLength(5);
    expect(detail.intent.naturalVAD?.valence).toBeLessThan(0);
    expect(detail.confidence).toBeGreaterThan(0);
  });

  it("serves normalized exact corpus matches without an embedding request", async () => {
    const provider: EmbeddingProvider = {
      isConfigured: () => false,
      embed: vi.fn(),
      batchEmbed: vi.fn()
    };
    const classifier = new EmbeddingMessageClassifier(provider);

    const detail = await classifier.classifyDetailed("  真他妈离谱！！！  ");

    expect(detail.source).toBe("exact");
    expect(detail.intent.emotion).toBe("anger");
    expect(detail.intent.naturalVAD).toEqual({ valence: -0.7, arousal: 0.75, dominance: 0.55 });
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("normalizes trailing emoji while retaining emoji-only queries", async () => {
    const provider = createProvider({ sample: [1, 0], "今天心情不错": [1, 0], "😊": [1, 0] });
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      examples: [example("sample", "happy"), example("今天心情不错", "happy")]
    });
    await classifier.initialize();

    const exact = await classifier.classifyDetailed("今天心情不错 😊");
    const emoji = await classifier.classifyDetailed("😊");

    expect(exact.source).toBe("exact");
    expect(emoji.source).toBe("embedding");
    expect(provider.embed).toHaveBeenCalledWith("😊", undefined);
  });

  it("reuses normalized query results through the LRU cache", async () => {
    const provider = createProvider({ sample: [1, 0], "新的消息": [1, 0] });
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      examples: [example("sample", "happy")]
    });

    await classifier.initialize();
    const first = await classifier.classifyDetailed("新的消息");
    const second = await classifier.classifyDetailed(" 新的消息！ ");

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(second.intent.sourceMessage).toBe(" 新的消息！ ");
  });

  it("loads example vectors from a persistent cache on the next startup", async () => {
    const stored = new Map<string, EmbeddingVectorCacheEntry>();
    const embeddingCache: EmbeddingVectorCache = {
      load: vi.fn(async key => stored.get(key) ?? null),
      save: vi.fn(async (key, entry) => {
        stored.set(key, entry);
      })
    };
    const firstProvider: EmbeddingProvider = {
      getCacheKey: () => "test-model",
      embed: vi.fn(async () => [1, 0]),
      batchEmbed: vi.fn(async () => [[1, 0]])
    };
    const first = new EmbeddingMessageClassifier(firstProvider, {
      includeDefaultExamples: false,
      embeddingCache,
      examples: [example("cached sample", "happy")]
    });
    await first.initialize();

    const secondProvider: EmbeddingProvider = {
      getCacheKey: () => "test-model",
      embed: vi.fn(async () => [1, 0]),
      batchEmbed: vi.fn(async () => [[0, 1]])
    };
    const second = new EmbeddingMessageClassifier(secondProvider, {
      includeDefaultExamples: false,
      embeddingCache,
      examples: [example("cached sample", "happy")]
    });
    await second.initialize();

    expect(firstProvider.batchEmbed).toHaveBeenCalledOnce();
    expect(secondProvider.batchEmbed).not.toHaveBeenCalled();
    expect(second.isInitialized).toBe(true);
  });

  it("falls back if query dimensions do not match the examples", async () => {
    const provider = createProvider({ sample: [1, 0], "我好焦虑": [1, 0, 0] });
    const classifier = new EmbeddingMessageClassifier(provider, {
      includeDefaultExamples: false,
      examples: [example("sample", "happy")]
    });

    await classifier.initialize();
    await expect(classifier.classify("我好焦虑")).resolves.toMatchObject({
      emotion: "anxiety",
      sourceMessage: "我好焦虑"
    });
  });
});
