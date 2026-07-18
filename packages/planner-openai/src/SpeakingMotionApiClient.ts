import type {
  SpeakingMotionPlan,
  SpeakingMotionPlanRequest
} from "./SoullinkSpeakingMotionPlanner";

export interface SpeakingMotionApiClientOptions {
  baseURL: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  timeoutMs?: number;
  path?: string;
}

export interface SpeakingMotionApiClient {
  plan(request: SpeakingMotionPlanRequest): Promise<SpeakingMotionPlan>;
  planSpeakingMotion(request: SpeakingMotionPlanRequest): Promise<SpeakingMotionPlan>;
}

export class PlannerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "PlannerApiError";
  }
}

export function createSpeakingMotionApiClient(
  options: SpeakingMotionApiClientOptions
): SpeakingMotionApiClient {
  const baseURL = normalizeBaseURL(options.baseURL);
  const path = normalizePath(options.path ?? "/llm/speaking-motion/plan");
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  const planSpeakingMotion = async (
    request: SpeakingMotionPlanRequest
  ): Promise<SpeakingMotionPlan> => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("No fetch implementation is available. Pass SpeakingMotionApiClientOptions.fetch.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const configuredHeaders = typeof options.headers === "function"
        ? await options.headers()
        : options.headers ?? {};
      const body = withoutServerCredentials(request);
      const response = await fetchImpl(baseURL + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...configuredHeaders
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        throw new PlannerApiError(
          "Speaking motion API request failed with " + response.status,
          response.status,
          responseBody
        );
      }
      return responseBody as SpeakingMotionPlan;
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    plan: planSpeakingMotion,
    planSpeakingMotion
  };
}

function withoutServerCredentials(
  request: SpeakingMotionPlanRequest
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...request };
  delete body.openAI;
  delete body.apiKey;
  delete body.openaiApiKey;
  return body;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeBaseURL(value: string): string {
  const baseURL = value.trim().replace(/\/+$/u, "");
  if (!baseURL) throw new Error("SpeakingMotionApiClientOptions.baseURL is required");
  return baseURL;
}

function normalizePath(value: string): string {
  const path = value.trim();
  return path.startsWith("/") ? path : "/" + path;
}

function normalizeTimeout(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 30000;
}
