import { getVADPreset, type EmotionIntent, type VADVector } from "@soullink-emotion/engine";
import { DEFAULT_EMOTION_EXAMPLES } from "./defaultExamples";
import type {
  EmbeddingClassificationDetail,
  EmbeddingEmotionScore,
  EmbeddingMatchedExample,
  EmbeddingMessageClassifierOptions,
  EmbeddingProvider,
  EmbeddingVectorCacheEntry,
  EmotionExampleInput,
  EmotionIntentTemplate
} from "./types";

interface EmotionExample {
  text: string;
  normalizedText: string;
  embedding: number[] | null;
  intent: EmotionIntentTemplate;
}

interface ScoredExample {
  example: EmotionExample;
  similarity: number;
  weight: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.65;
const DEFAULT_INITIALIZATION_BATCH_SIZE = 128;
const DEFAULT_TOP_K = 5;
const DEFAULT_QUERY_CACHE_SIZE = 256;

function cloneIntent(intent: EmotionIntentTemplate): EmotionIntentTemplate {
  return {
    ...intent,
    naturalVAD: intent.naturalVAD ? { ...intent.naturalVAD } : undefined,
    contextTags: [...intent.contextTags]
  };
}

function cloneExample(example: EmotionExampleInput): EmotionExample {
  return {
    text: example.text,
    normalizedText: normalizeEmotionText(example.text),
    embedding: normalizeEmbedding(example.embedding ?? null),
    intent: cloneIntent(example.intent)
  };
}

function isValidEmbedding(value: readonly number[] | null | undefined): value is readonly number[] {
  return Boolean(value?.length) && value!.every(Number.isFinite);
}

function normalizeEmbedding(value: readonly number[] | null): number[] | null {
  if (!isValidEmbedding(value)) return null;
  let squaredNorm = 0;
  for (const item of value) squaredNorm += item * item;
  if (squaredNorm === 0) return null;
  const norm = Math.sqrt(squaredNorm);
  return Array.from(value, item => item / norm);
}

function cloneDetail(detail: EmbeddingClassificationDetail, cacheHit = detail.cacheHit): EmbeddingClassificationDetail {
  return {
    ...detail,
    intent: {
      ...detail.intent,
      naturalVAD: detail.intent.naturalVAD ? { ...detail.intent.naturalVAD } : undefined,
      contextTags: [...detail.intent.contextTags]
    },
    naturalVAD: { ...detail.naturalVAD },
    matchedExamples: detail.matchedExamples.map(match => ({ ...match })),
    emotionScores: detail.emotionScores.map(score => ({ ...score })),
    cacheHit
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizeEmotionText(input: string): string {
  const normalized = input.normalize("NFKC").trim().toLowerCase();
  const compact = normalized.replace(/[\p{P}\p{S}\s]+/gu, "");
  return compact || normalized.replace(/\s+/gu, " ");
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions do not match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dotProduct += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizedDotProduct(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions do not match: ${a.length} vs ${b.length}`);
  }
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result += a[index] * b[index];
  return result;
}

export function classifyEmotionByRules(message: string): EmotionIntent {
  const text = message.trim();

  if (/(过了|成功|赢了|拿下|通过|上岸|好消息)/u.test(text)) {
    return { emotion: "happy", variant: "surprised_happy", intensity: 0.85, contextTags: ["user_good_news"], sourceMessage: text };
  }
  if (/(喜欢你|可爱|好看|夸夸|贴贴)/u.test(text)) {
    return { emotion: "shy", variant: "bashful", intensity: 0.8, contextTags: ["compliment", "warm"], sourceMessage: text };
  }
  if (/(兴奋|太爽|冲啊|炸了|激动)/u.test(text)) {
    return { emotion: "excited", variant: "sparkle", intensity: 0.86, contextTags: ["user_good_news"], sourceMessage: text };
  }
  if (/(累|难受|不开心|崩溃|压力|困|疼)/u.test(text)) {
    const tired = /(累|困|没精神)/u.test(text);
    return {
      emotion: tired ? "tired" : "concerned",
      variant: tired ? "drained" : "comfort",
      intensity: 0.75,
      contextTags: ["user_tired", "warm"],
      sourceMessage: text
    };
  }
  if (/(难过|伤心|想哭|委屈|失落)/u.test(text)) {
    return { emotion: "sad", variant: "downcast", intensity: 0.72, contextTags: ["comfort"], sourceMessage: text };
  }
  if (/(焦虑|慌|害怕|紧张|不安)/u.test(text)) {
    return { emotion: "anxiety", variant: "nervous", intensity: 0.76, contextTags: ["comfort"], sourceMessage: text };
  }
  if (/(怎么|为什么|咋回事|啥|不懂|疑惑)/u.test(text)) {
    const curious = /(好奇|想知道|什么原因)/u.test(text);
    return {
      emotion: curious ? "curious" : "confused",
      variant: curious ? "tilt" : "confused",
      intensity: 0.68,
      contextTags: ["question", "curious"],
      sourceMessage: text
    };
  }
  if (/(生气|气死|讨厌|烦|离谱)/u.test(text)) {
    return { emotion: "anger", variant: "annoyed", intensity: 0.62, contextTags: ["annoyed"], sourceMessage: text };
  }

  return { emotion: "neutral", variant: "neutral_ack", intensity: 0.35, contextTags: ["normal_chat"], sourceMessage: text };
}

export class EmbeddingMessageClassifier<TProviderOptions = unknown> {
  private readonly examples: EmotionExample[];
  private readonly exactExamples = new Map<string, EmotionExample>();
  private readonly queryCache = new Map<string, EmbeddingClassificationDetail>();
  private readonly similarityThreshold: number;
  private readonly initializationBatchSize: number;
  private readonly topK: number;
  private readonly queryCacheSize: number;
  private readonly fallbackClassifier: (message: string) => EmotionIntent | Promise<EmotionIntent>;
  private initialized = false;
  private initialization: Promise<void> | undefined;

  constructor(
    private readonly provider: EmbeddingProvider<TProviderOptions>,
    private readonly options: EmbeddingMessageClassifierOptions = {}
  ) {
    const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
      throw new RangeError("similarityThreshold must be between -1 and 1");
    }

    const batchSize = options.initializationBatchSize ?? DEFAULT_INITIALIZATION_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new RangeError("initializationBatchSize must be a positive integer");
    }
    const topK = options.topK ?? DEFAULT_TOP_K;
    if (!Number.isInteger(topK) || topK <= 0) {
      throw new RangeError("topK must be a positive integer");
    }
    const queryCacheSize = options.queryCacheSize ?? DEFAULT_QUERY_CACHE_SIZE;
    if (!Number.isInteger(queryCacheSize) || queryCacheSize < 0) {
      throw new RangeError("queryCacheSize must be a non-negative integer");
    }

    this.similarityThreshold = threshold;
    this.initializationBatchSize = batchSize;
    this.topK = topK;
    this.queryCacheSize = queryCacheSize;
    this.fallbackClassifier = options.fallbackClassifier ?? classifyEmotionByRules;
    const initialExamples = [
      ...(options.includeDefaultExamples === false ? [] : DEFAULT_EMOTION_EXAMPLES),
      ...(options.examples ?? [])
    ];
    this.examples = initialExamples.map(cloneExample);
    this.rebuildExactExamples();
    this.refreshInitializedState();
  }

  async initialize(providerOptions?: TProviderOptions): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;

    if (this.provider.isConfigured && !this.provider.isConfigured(providerOptions)) {
      this.options.logger?.warn?.("Embedding provider is not configured; classifier will use fallback mode");
      return;
    }

    this.initialization = this.initializeMissingExamples(providerOptions);
    try {
      await this.initialization;
    } finally {
      this.initialization = undefined;
    }
  }

  private async initializeMissingExamples(providerOptions?: TProviderOptions): Promise<void> {
    try {
      const cacheNamespace = this.resolveEmbeddingCacheNamespace(providerOptions);
      const cachedEntry = await this.loadEmbeddingCache(cacheNamespace);
      if (cachedEntry) this.applyCachedEmbeddings(cachedEntry);

      let missing = this.examples.filter(example => !isValidEmbedding(example.embedding));
      let cacheChanged = false;
      if (missing.length > 0) {
        await this.embedMissingExamples(missing, providerOptions);
        cacheChanged = true;
      }

      this.refreshInitializedState();
      if (!this.initialized && cachedEntry) {
        this.clearCachedEmbeddings(cachedEntry);
        missing = this.examples.filter(example => !isValidEmbedding(example.embedding));
        await this.embedMissingExamples(missing, providerOptions);
        cacheChanged = true;
        this.refreshInitializedState();
      }
      if (!this.initialized) throw new Error("Embedding provider returned inconsistent vector dimensions");

      if (cacheChanged) await this.saveEmbeddingCache(cacheNamespace, cachedEntry);
      this.options.logger?.debug?.(`Embedding classifier initialized with ${this.examples.length} examples`);
    } catch (error) {
      this.initialized = false;
      this.options.logger?.error?.("Failed to initialize embedding classifier", error);
      throw error;
    }
  }

  private async embedMissingExamples(
    missing: EmotionExample[],
    providerOptions?: TProviderOptions
  ): Promise<void> {
    for (let offset = 0; offset < missing.length; offset += this.initializationBatchSize) {
      const batch = missing.slice(offset, offset + this.initializationBatchSize);
      const embeddings = await this.provider.batchEmbed(
        batch.map(example => example.text),
        providerOptions
      );
      if (embeddings.length !== batch.length) {
        throw new Error(
          `Embedding provider returned ${embeddings.length} vectors for a batch of ${batch.length} examples`
        );
      }
      embeddings.forEach((embedding, index) => {
        const normalized = normalizeEmbedding(embedding);
        if (!normalized) throw new Error(`Embedding provider returned an invalid vector at index ${offset + index}`);
        batch[index].embedding = normalized;
      });
    }
  }

  async classify(message: string, providerOptions?: TProviderOptions): Promise<EmotionIntent> {
    const detail = await this.classifyDetailed(message, providerOptions);
    return detail.intent;
  }

  async classifyDetailed(
    message: string,
    providerOptions?: TProviderOptions
  ): Promise<EmbeddingClassificationDetail> {
    const text = message.trim();
    const normalizedText = normalizeEmotionText(text);
    const exact = this.exactExamples.get(normalizedText);
    if (exact) return this.createExactDetail(exact, message);

    if (!this.initialized) {
      return this.runFallbackDetailed(text, "classifier-not-initialized");
    }

    const providerCacheKey = this.resolveProviderCacheKey(providerOptions);
    const cacheKey = providerCacheKey || providerOptions === undefined
      ? `${providerCacheKey ?? "provider"}:${normalizedText}`
      : undefined;
    const cached = cacheKey ? this.getQueryCache(cacheKey) : undefined;
    if (cached) {
      cached.intent.sourceMessage = message;
      return cached;
    }

    try {
      const queryEmbedding = normalizeEmbedding(await this.provider.embed(text, providerOptions));
      if (!queryEmbedding) throw new Error("Embedding provider returned an invalid query vector");

      const nearest = this.findNearest(queryEmbedding);
      const detail = this.createEmbeddingDetail(nearest, message);
      if (cacheKey) this.setQueryCache(cacheKey, detail);
      return cloneDetail(detail);
    } catch (error) {
      this.options.logger?.error?.("Embedding classification failed; using fallback", error);
      return this.runFallbackDetailed(text, "embedding-query-failed");
    }
  }

  addExample(text: string, intent: EmotionIntentTemplate, embedding?: readonly number[]): void {
    this.addExamples([{ text, intent, embedding }]);
  }

  addExamples(examples: readonly EmotionExampleInput[]): void {
    for (const example of examples) {
      if (!example.text.trim()) throw new Error("Emotion example text must not be empty");
      const cloned = cloneExample(example);
      this.examples.push(cloned);
      this.exactExamples.set(cloned.normalizedText, cloned);
    }
    this.clearQueryCache();
    this.refreshInitializedState();
  }

  clearQueryCache(): void {
    this.queryCache.clear();
  }

  private findNearest(queryEmbedding: readonly number[]): ScoredExample[] {
    const nearest: ScoredExample[] = [];
    for (const example of this.examples) {
      if (!example.embedding) continue;
      const similarity = normalizedDotProduct(queryEmbedding, example.embedding);
      const scored = { example, similarity, weight: this.similarityWeight(similarity) };
      let insertAt = nearest.findIndex(item => similarity > item.similarity);
      if (insertAt === -1) insertAt = nearest.length;
      if (insertAt < this.topK) nearest.splice(insertAt, 0, scored);
      if (nearest.length > this.topK) nearest.pop();
    }
    return nearest;
  }

  private createEmbeddingDetail(nearest: ScoredExample[], sourceMessage: string): EmbeddingClassificationDetail {
    const bestSimilarity = nearest[0]?.similarity ?? -1;
    const matchedExamples = nearest.map(item => this.toMatchedExample(item));
    if (!nearest[0] || bestSimilarity <= this.similarityThreshold) {
      const intent = this.neutralIntent(sourceMessage);
      const naturalVAD = this.intentVAD(intent);
      return {
        intent,
        source: "neutral",
        confidence: 0,
        similarity: bestSimilarity,
        naturalVAD,
        matchedExamples,
        emotionScores: [],
        cacheHit: false
      };
    }

    const accepted = nearest.filter(item => item.similarity > this.similarityThreshold);
    const scoreMap = new Map<string, number>();
    for (const item of accepted) {
      const emotion = item.example.intent.emotion;
      scoreMap.set(emotion, (scoreMap.get(emotion) ?? 0) + item.weight);
    }
    const totalScore = [...scoreMap.values()].reduce((sum, score) => sum + score, 0);
    const emotionScores: EmbeddingEmotionScore[] = [...scoreMap]
      .map(([emotion, score]) => ({ emotion, score, share: totalScore > 0 ? score / totalScore : 0 }))
      .sort((a, b) => b.score - a.score);
    const winningEmotion = emotionScores[0]?.emotion ?? nearest[0].example.intent.emotion;
    const winners = accepted.filter(item => item.example.intent.emotion === winningEmotion);
    const representative = winners[0] ?? nearest[0];
    const winningWeight = winners.reduce((sum, item) => sum + item.weight, 0);
    const intensity = winningWeight > 0
      ? winners.reduce((sum, item) => sum + item.example.intent.intensity * item.weight, 0) / winningWeight
      : representative.example.intent.intensity;
    const naturalVAD = this.weightedVAD(accepted);
    const contextTags = [...new Set(winners.flatMap(item => item.example.intent.contextTags))];
    const intent: EmotionIntent = {
      ...cloneIntent(representative.example.intent),
      emotion: winningEmotion,
      intensity: clamp01(intensity),
      contextTags,
      naturalVAD,
      sourceMessage
    };
    const similarityConfidence = clamp01(
      (bestSimilarity - this.similarityThreshold) / Math.max(0.000001, 1 - this.similarityThreshold)
    );
    const confidence = clamp01(similarityConfidence * 0.55 + (emotionScores[0]?.share ?? 0) * 0.45);

    return {
      intent,
      source: "embedding",
      confidence,
      similarity: bestSimilarity,
      naturalVAD,
      matchedExamples,
      emotionScores,
      cacheHit: false
    };
  }

  private createExactDetail(example: EmotionExample, sourceMessage: string): EmbeddingClassificationDetail {
    const intent = cloneIntent(example.intent);
    const naturalVAD = this.intentVAD(intent);
    return {
      intent: { ...intent, naturalVAD, sourceMessage },
      source: "exact",
      confidence: 1,
      similarity: 1,
      naturalVAD,
      matchedExamples: [{
        text: example.text,
        emotion: intent.emotion,
        variant: intent.variant,
        intensity: intent.intensity,
        similarity: 1,
        weight: 1
      }],
      emotionScores: [{ emotion: intent.emotion, score: 1, share: 1 }],
      cacheHit: false
    };
  }

  private toMatchedExample(item: ScoredExample): EmbeddingMatchedExample {
    return {
      text: item.example.text,
      emotion: item.example.intent.emotion,
      variant: item.example.intent.variant,
      intensity: item.example.intent.intensity,
      similarity: item.similarity,
      weight: item.weight
    };
  }

  private similarityWeight(similarity: number): number {
    if (similarity <= this.similarityThreshold) return 0;
    return Math.max(0.000001, (similarity - this.similarityThreshold) /
      Math.max(0.000001, 1 - this.similarityThreshold));
  }

  private weightedVAD(examples: ScoredExample[]): VADVector {
    let totalWeight = 0;
    const result: VADVector = { valence: 0, arousal: 0, dominance: 0 };
    for (const item of examples) {
      const vad = this.intentVAD(item.example.intent);
      totalWeight += item.weight;
      result.valence += vad.valence * item.weight;
      result.arousal += vad.arousal * item.weight;
      result.dominance += vad.dominance * item.weight;
    }
    if (totalWeight === 0) return result;
    return this.roundVAD({
      valence: result.valence / totalWeight,
      arousal: result.arousal / totalWeight,
      dominance: result.dominance / totalWeight
    });
  }

  private intentVAD(intent: EmotionIntentTemplate): VADVector {
    const preset = getVADPreset(
      intent.naturalEmotion ?? intent.emotion,
      intent.naturalVariant ?? intent.variant
    );
    return this.roundVAD({
      valence: intent.naturalVAD?.valence ?? preset.valence,
      arousal: intent.naturalVAD?.arousal ?? preset.arousal,
      dominance: intent.naturalVAD?.dominance ?? preset.dominance
    });
  }

  private roundVAD(vad: VADVector): VADVector {
    return {
      valence: Math.round(vad.valence * 1_000_000) / 1_000_000,
      arousal: Math.round(vad.arousal * 1_000_000) / 1_000_000,
      dominance: Math.round(vad.dominance * 1_000_000) / 1_000_000
    };
  }

  private neutralIntent(sourceMessage: string): EmotionIntent {
    return {
      emotion: "neutral",
      variant: "neutral_ack",
      intensity: 0.35,
      contextTags: ["normal_chat"],
      naturalVAD: { valence: 0, arousal: 0, dominance: 0 },
      sourceMessage
    };
  }

  private async runFallbackDetailed(text: string, fallbackReason: string): Promise<EmbeddingClassificationDetail> {
    const intent = await this.fallbackClassifier(text);
    const cloned: EmotionIntent = {
      ...intent,
      naturalVAD: intent.naturalVAD ? { ...intent.naturalVAD } : undefined,
      contextTags: [...intent.contextTags],
      sourceMessage: intent.sourceMessage ?? text
    };
    const naturalVAD = this.intentVAD(cloned);
    cloned.naturalVAD = naturalVAD;
    return {
      intent: cloned,
      source: "fallback",
      confidence: 0,
      similarity: -1,
      naturalVAD,
      matchedExamples: [],
      emotionScores: [],
      cacheHit: false,
      fallbackReason
    };
  }

  private getQueryCache(key: string): EmbeddingClassificationDetail | undefined {
    const cached = this.queryCache.get(key);
    if (!cached) return undefined;
    this.queryCache.delete(key);
    this.queryCache.set(key, cached);
    return cloneDetail(cached, true);
  }

  private setQueryCache(key: string, detail: EmbeddingClassificationDetail): void {
    if (this.queryCacheSize === 0) return;
    this.queryCache.delete(key);
    this.queryCache.set(key, cloneDetail(detail, false));
    while (this.queryCache.size > this.queryCacheSize) {
      const oldest = this.queryCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.queryCache.delete(oldest);
    }
  }

  private rebuildExactExamples(): void {
    this.exactExamples.clear();
    for (const example of this.examples) this.exactExamples.set(example.normalizedText, example);
  }

  private refreshInitializedState(): void {
    if (this.examples.length === 0 || !this.examples.every(example => isValidEmbedding(example.embedding))) {
      this.initialized = false;
      return;
    }
    const dimension = this.examples[0].embedding!.length;
    this.initialized = this.examples.every(example => example.embedding!.length === dimension);
  }

  private resolveProviderCacheKey(providerOptions?: TProviderOptions): string | undefined {
    return this.options.embeddingCacheKey ?? this.provider.getCacheKey?.(providerOptions);
  }

  private resolveEmbeddingCacheNamespace(providerOptions?: TProviderOptions): string | undefined {
    if (!this.options.embeddingCache) return undefined;
    const providerKey = this.resolveProviderCacheKey(providerOptions);
    if (!providerKey) {
      this.options.logger?.warn?.(
        "embeddingCache requires embeddingCacheKey or a provider with getCacheKey(); skipping persistent cache"
      );
    }
    return providerKey;
  }

  private async loadEmbeddingCache(namespace: string | undefined): Promise<EmbeddingVectorCacheEntry | null> {
    if (!namespace || !this.options.embeddingCache) return null;
    try {
      const entry = await this.options.embeddingCache.load(namespace);
      return entry?.version === 1 ? entry : null;
    } catch (error) {
      this.options.logger?.warn?.(`Failed to load embedding cache: ${String(error)}`);
      return null;
    }
  }

  private applyCachedEmbeddings(entry: EmbeddingVectorCacheEntry): void {
    for (const example of this.examples) {
      if (example.embedding) continue;
      const normalized = normalizeEmbedding(entry.embeddings[example.text] ?? null);
      if (normalized) example.embedding = normalized;
    }
  }

  private clearCachedEmbeddings(entry: EmbeddingVectorCacheEntry): void {
    for (const example of this.examples) {
      if (Object.hasOwn(entry.embeddings, example.text)) example.embedding = null;
    }
  }

  private async saveEmbeddingCache(
    namespace: string | undefined,
    loaded: EmbeddingVectorCacheEntry | null
  ): Promise<void> {
    if (!namespace || !this.options.embeddingCache) return;
    const embeddings: Record<string, readonly number[]> = { ...(loaded?.embeddings ?? {}) };
    for (const example of this.examples) {
      if (example.embedding) embeddings[example.text] = example.embedding;
    }
    try {
      await this.options.embeddingCache.save(namespace, { version: 1, embeddings });
    } catch (error) {
      this.options.logger?.warn?.(`Failed to save embedding cache: ${String(error)}`);
    }
  }

  get exampleCount(): number {
    return this.examples.length;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}
