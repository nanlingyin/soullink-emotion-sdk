import type { EmbeddingProvider } from "./types";

export type EmbeddingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface QwenEmbeddingClientOptions {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: EmbeddingFetch;
  headers?: Readonly<Record<string, string>>;
}

export interface QwenEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface QwenEmbeddingClientConfig {
  configured: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
}

export class QwenEmbeddingClientNotConfiguredError extends Error {
  constructor() {
    super("Qwen embedding client is not configured");
    this.name = "QwenEmbeddingClientNotConfiguredError";
  }
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "Qwen/Qwen3-VL-Embedding-8B";
const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function resolveGlobalFetch(): EmbeddingFetch | undefined {
  return typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : undefined;
}

export class QwenEmbeddingClient implements EmbeddingProvider<QwenEmbeddingClientOptions> {
  private readonly defaults: Required<
    Pick<QwenEmbeddingClientOptions, "baseURL" | "model" | "timeoutMs">
  > & Pick<QwenEmbeddingClientOptions, "apiKey" | "fetch" | "headers">;

  constructor(options: QwenEmbeddingClientOptions = {}) {
    this.defaults = {
      baseURL: options.baseURL ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      model: options.model ?? DEFAULT_MODEL,
      timeoutMs: normalizeTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS),
      fetch: options.fetch,
      headers: options.headers
    };
  }

  get config(): QwenEmbeddingClientConfig {
    return {
      configured: Boolean(this.defaults.apiKey?.trim()),
      baseURL: this.defaults.baseURL,
      model: this.defaults.model,
      timeoutMs: this.defaults.timeoutMs
    };
  }

  isConfigured(options?: QwenEmbeddingClientOptions): boolean {
    return Boolean((options?.apiKey ?? this.defaults.apiKey)?.trim());
  }

  getCacheKey(options: QwenEmbeddingClientOptions = {}): string {
    const baseURL = (options.baseURL ?? this.defaults.baseURL).replace(/\/+$/u, "");
    const model = options.model ?? this.defaults.model;
    return `openai-compatible:${baseURL}:${model}`;
  }

  async createEmbedding(
    input: string | string[],
    options: QwenEmbeddingClientOptions = {}
  ): Promise<QwenEmbeddingResponse> {
    const baseURL = (options.baseURL ?? this.defaults.baseURL).replace(/\/+$/u, "");
    const apiKey = options.apiKey ?? this.defaults.apiKey;
    const model = options.model ?? this.defaults.model;
    const timeoutMs = normalizeTimeout(options.timeoutMs, this.defaults.timeoutMs);
    const fetcher = options.fetch ?? this.defaults.fetch ?? resolveGlobalFetch();

    if (!apiKey?.trim()) {
      throw new QwenEmbeddingClientNotConfiguredError();
    }
    if (!fetcher) {
      throw new Error("No fetch implementation is available for the embedding client");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher(`${baseURL}/embeddings`, {
        method: "POST",
        headers: {
          ...(this.defaults.headers ?? {}),
          ...(options.headers ?? {}),
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input,
          encoding_format: "float"
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Embedding API failed with ${response.status}: ${text}`);
      }

      return (await response.json()) as QwenEmbeddingResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Embedding API timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async embed(text: string, options?: QwenEmbeddingClientOptions): Promise<number[]> {
    const response = await this.createEmbedding(text, options);
    return response.data[0]?.embedding ?? [];
  }

  async batchEmbed(
    texts: string[],
    options?: QwenEmbeddingClientOptions
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.createEmbedding(texts, options);
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);
  }
}
