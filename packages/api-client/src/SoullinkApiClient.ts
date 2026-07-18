import type { EmotionIntent } from "@soullink-emotion/engine";
import type {
  AutoProfileRequest,
  AutoProfileResult,
  CalibrationSaveRequest,
  CloneVoiceRequest,
  EmbeddingClassifyResponse,
  EmbeddingConfig,
  HealthResponse,
  ModelSummary,
  ModelUploadRequest,
  ModelUploadResult,
  OpenAIProviderRequestConfig,
  ProactiveMessagePlan,
  ProactiveMessageRequest,
  ReactionPlan,
  ReactionPlanRequest,
  ReflectionPlan,
  ReflectionPlanRequest,
  SpeakingMotionPlan,
  SpeakingMotionPlanRequest,
  TtsConfig,
  VoiceRequest
} from "./types";

export interface SoullinkApiTimeouts {
  default: number;
  llm: number;
  proactive: number;
  tts: number;
  profile: number;
  modelUpload: number;
  embedding: number;
}

export const defaultSoullinkApiTimeouts: Readonly<SoullinkApiTimeouts> = {
  default: 30_000,
  llm: 60_000,
  proactive: 45_000,
  tts: 900_000,
  profile: 90_000,
  modelUpload: 300_000,
  embedding: 10_000
};

export type SoullinkApiToken = string | (() => string | undefined);
export type SoullinkFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SoullinkApiClientOptions {
  baseURL: string;
  fetch?: SoullinkFetch;
  /** Bearer token attached lazily to every request. */
  token?: SoullinkApiToken;
  headers?: Record<string, string>;
  timeouts?: Partial<SoullinkApiTimeouts>;
}

export class SoullinkApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly responseBody: string;

  constructor(message: string, options: { status: number; path: string; responseBody: string }) {
    super(message);
    this.name = "SoullinkApiError";
    this.status = options.status;
    this.path = options.path;
    this.responseBody = options.responseBody;
  }
}

export class SoullinkApiTimeoutError extends Error {
  readonly path: string;
  readonly timeoutMs: number;

  constructor(path: string, timeoutMs: number) {
    super(`${path} timed out after ${formatSeconds(timeoutMs)}s`);
    this.name = "SoullinkApiTimeoutError";
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

export class SoullinkApiClient {
  readonly baseURL: string;
  readonly timeouts: Readonly<SoullinkApiTimeouts>;
  private readonly fetchImpl: SoullinkFetch;
  private readonly token?: SoullinkApiToken;
  private readonly headers: Record<string, string>;

  constructor(options: SoullinkApiClientOptions) {
    const baseURL = options.baseURL?.trim().replace(/\/+$/u, "");
    if (!baseURL) throw new Error("SoullinkApiClient requires a non-empty baseURL");

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("SoullinkApiClient requires fetch; inject it through options.fetch");
    }

    this.baseURL = baseURL;
    this.fetchImpl = fetchImpl.bind(globalThis) as SoullinkFetch;
    this.token = options.token;
    this.headers = { ...options.headers };
    this.timeouts = resolveTimeouts(options.timeouts);
  }

  health(): Promise<HealthResponse> {
    return this.getJson("/health", this.timeouts.default);
  }

  classifyReaction(message: string): Promise<EmotionIntent> {
    return this.postJson("/reaction/classify", { message }, this.timeouts.default);
  }

  classifyWithEmbedding(request: {
    message: string;
    openAI?: OpenAIProviderRequestConfig;
  }): Promise<EmbeddingClassifyResponse> {
    return this.postJson("/reaction/classify-embedding", request, this.timeouts.embedding);
  }

  getEmbeddingConfig(): Promise<EmbeddingConfig> {
    return this.getJson("/embedding/config", this.timeouts.embedding);
  }

  getLlmConfig<T = Record<string, unknown>>(): Promise<T> {
    return this.getJson("/llm/config", this.timeouts.default);
  }

  getSpeakingMotionConfig<T = Record<string, unknown>>(): Promise<T> {
    return this.getJson("/llm/speaking-motion/config", this.timeouts.default);
  }

  ensureAutoProfile(request: AutoProfileRequest): Promise<AutoProfileResult> {
    return this.postJson("/profile/auto/generate", request, this.timeouts.profile);
  }

  saveCalibratedProfile(request: CalibrationSaveRequest): Promise<AutoProfileResult> {
    return this.postJson("/profile/save", request, this.timeouts.profile);
  }

  async uploadLive2DModel(request: ModelUploadRequest): Promise<ModelUploadResult> {
    const form = new FormData();
    const manifest = request.files.map((file, index) => ({
      name: getFileName(file, index),
      size: file.size,
      lastModified: file.lastModified ?? 0,
      relativePath: getFileRelativePath(file, index)
    }));

    if (request.modelDir?.trim()) form.append("modelDir", request.modelDir.trim());
    if (request.displayName?.trim()) form.append("displayName", request.displayName.trim());
    if (request.openAI) form.append("openAI", JSON.stringify(request.openAI));
    form.append("manifest", JSON.stringify(manifest));

    request.files.forEach((file, index) => {
      form.append("files", file, getFileRelativePath(file, index));
    });

    return this.postFormData("/models/upload", form, this.timeouts.modelUpload);
  }

  listModels(options: { includeIncomplete?: boolean } = {}): Promise<{ models: ModelSummary[] }> {
    const query = options.includeIncomplete ? "?includeIncomplete=1" : "";
    return this.getJson(`/models${query}`, this.timeouts.profile);
  }

  getModel(modelDir: string): Promise<ModelSummary> {
    return this.getJson(`/models/${encodeURIComponent(modelDir)}`, this.timeouts.profile);
  }

  planReaction(request: ReactionPlanRequest): Promise<ReactionPlan> {
    return this.postJson("/llm/reaction/plan", request, this.timeouts.llm);
  }

  planSpeakingMotion(request: SpeakingMotionPlanRequest): Promise<SpeakingMotionPlan> {
    return this.postJson("/llm/speaking-motion/plan", request, this.timeouts.llm);
  }

  planReflection(request: ReflectionPlanRequest): Promise<ReflectionPlan> {
    return this.postJson("/llm/reflection/plan", request, this.timeouts.llm);
  }

  planProactiveMessage(request: ProactiveMessageRequest): Promise<ProactiveMessagePlan> {
    return this.postJson("/llm/proactive/message", request, this.timeouts.proactive);
  }

  async synthesizeVoice(request: VoiceRequest): Promise<Blob> {
    const path = request.provider === "cosyvoice2" ? "/tts/cosyvoice2" : "/tts/voxcpm2";
    const response = await this.postRaw(path, request, this.timeouts.tts);
    return response.blob();
  }

  async cloneVoice(request: CloneVoiceRequest): Promise<Blob> {
    const response = await this.postRaw("/tts/voxcpm2/clone", request, this.timeouts.tts);
    return response.blob();
  }

  getTtsConfig(): Promise<TtsConfig> {
    return this.getJson("/tts/config", this.timeouts.default);
  }

  previewVoiceControl(request: Pick<VoiceRequest, "control" | "emotion" | "vad">): Promise<{ control: string }> {
    return this.postJson("/tts/voxcpm2/control-preview", request, this.timeouts.default);
  }

  private async getJson<T>(path: string, timeoutMs: number): Promise<T> {
    const response = await this.request(path, { method: "GET" }, timeoutMs);
    return response.json() as Promise<T>;
  }

  private async postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    const response = await this.postRaw(path, body, timeoutMs);
    return response.json() as Promise<T>;
  }

  private async postFormData<T>(path: string, body: FormData, timeoutMs: number): Promise<T> {
    const response = await this.request(path, { method: "POST", body }, timeoutMs);
    return response.json() as Promise<T>;
  }

  private postRaw(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    return this.request(path, {
      method: "POST",
      headers: isFormData ? undefined : { "Content-Type": "application/json" },
      body: isFormData ? body : JSON.stringify(body)
    }, timeoutMs);
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = typeof this.token === "function" ? this.token() : this.token;
      const headers: Record<string, string> = {
        ...this.headers,
        ...headersToRecord(init.headers)
      };
      if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;

      const response = await this.fetchImpl(`${this.baseURL}${path}`, {
        ...init,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        signal: controller.signal
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new SoullinkApiError(errorMessage(responseBody, path, response.status), {
          status: response.status,
          path,
          responseBody
        });
      }

      return response;
    } catch (error) {
      if (controller.signal.aborted) throw new SoullinkApiTimeoutError(path, timeoutMs);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createSoullinkApiClient(options: SoullinkApiClientOptions): SoullinkApiClient {
  return new SoullinkApiClient(options);
}

function resolveTimeouts(input: Partial<SoullinkApiTimeouts> | undefined): SoullinkApiTimeouts {
  const resolved = { ...defaultSoullinkApiTimeouts };
  for (const key of Object.keys(resolved) as Array<keyof SoullinkApiTimeouts>) {
    const value = input?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) resolved[key] = value;
  }
  return resolved;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function getFileName(file: { name?: string }, index: number): string {
  return file.name?.trim() || `model-file-${index + 1}`;
}

function getFileRelativePath(file: { name?: string; webkitRelativePath?: string }, index: number): string {
  return file.webkitRelativePath?.trim() || getFileName(file, index);
}

function errorMessage(body: string, path: string, status: number): string {
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === "string" && parsed.error) return parsed.error;
      if (typeof parsed.message === "string" && parsed.message) return parsed.message;
    } catch {
      return body;
    }
    return body;
  }
  return `${path} failed with ${status}`;
}

function formatSeconds(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
