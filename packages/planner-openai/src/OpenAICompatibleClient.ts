import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIClientOptions,
  OpenAICompatibleClientLike
} from "./openAICompatibleTypes";

export class OpenAIClientNotConfiguredError extends Error {
  constructor() {
    super("OpenAI-compatible client is not configured. Pass an apiKey or an injected client.");
    this.name = "OpenAIClientNotConfiguredError";
  }
}

export class OpenAICompatibleClient implements OpenAICompatibleClientLike {
  private apiKey?: string;
  private baseURL: string;
  private model: string;
  private organization?: string;
  private project?: string;
  private timeoutMs: number;
  private fetchImpl?: typeof globalThis.fetch;

  constructor(options: OpenAIClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = this.normalizeBaseURL(options.baseURL ?? "https://api.openai.com/v1");
    this.model = options.model ?? "gpt-4.1-mini";
    this.organization = options.organization;
    this.project = options.project;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetchImpl = options.fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  isConfigured(options: OpenAIClientOptions = {}): boolean {
    return Boolean(options.apiKey ?? this.apiKey);
  }

  get config() {
    return {
      configured: this.configured,
      baseURL: this.baseURL,
      model: this.model,
      timeoutMs: this.timeoutMs
    };
  }

  async createChatCompletion(
    request: OpenAIChatCompletionRequest,
    options: OpenAIClientOptions = {}
  ): Promise<OpenAIChatCompletionResponse> {
    const apiKey = options.apiKey ?? this.apiKey;
    const baseURL = this.normalizeBaseURL(options.baseURL ?? this.baseURL);
    const model = options.model ?? request.model ?? this.model;
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.timeoutMs);
    const fetchImpl = options.fetch ?? this.fetchImpl ?? globalThis.fetch;

    if (!apiKey) {
      throw new OpenAIClientNotConfiguredError();
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("No fetch implementation is available. Pass OpenAIClientOptions.fetch.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders({
          apiKey,
          organization: options.organization ?? this.organization,
          project: options.project ?? this.project
        }),
        body: JSON.stringify({
          ...request,
          model,
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI-compatible request failed with ${response.status}: ${body}`);
      }

      return (await response.json()) as OpenAIChatCompletionResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getHeaders(options: { apiKey: string; organization?: string; project?: string }): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    };

    if (options.organization) headers["OpenAI-Organization"] = options.organization;
    if (options.project) headers["OpenAI-Project"] = options.project;

    return headers;
  }

  private normalizeBaseURL(baseURL: string): string {
    return baseURL.replace(/\/+$/u, "");
  }
}

export function isOpenAICompatibleClientLike(value: unknown): value is OpenAICompatibleClientLike {
  if (!value || typeof value !== "object") return false;
  const client = value as Partial<OpenAICompatibleClientLike>;
  return typeof client.isConfigured === "function" && typeof client.createChatCompletion === "function";
}

function normalizeTimeout(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 30000;
}
