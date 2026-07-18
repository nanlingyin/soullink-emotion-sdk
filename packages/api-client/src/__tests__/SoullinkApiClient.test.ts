import { describe, expect, it, vi } from "vitest";
import {
  SoullinkApiClient,
  SoullinkApiError,
  SoullinkApiTimeoutError,
  type SoullinkFetch
} from "../index";

describe("SoullinkApiClient", () => {
  it("normalizes the base URL, appends queries, and resolves the bearer token lazily", async () => {
    let token = "first-token";
    const fetch = vi.fn<SoullinkFetch>(async (_input, _init) => jsonResponse({ models: [] }));
    const client = new SoullinkApiClient({
      baseURL: "https://example.test/api///",
      fetch,
      token: () => token,
      headers: { "X-Client": "test" }
    });

    await client.listModels({ includeIncomplete: true });
    token = "second-token";
    await client.listModels();

    expect(fetch).toHaveBeenNthCalledWith(1,
      "https://example.test/api/models?includeIncomplete=1",
      expect.objectContaining({ method: "GET" }));
    expect(fetch).toHaveBeenNthCalledWith(2,
      "https://example.test/api/models",
      expect.objectContaining({ method: "GET" }));

    const firstHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetch.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer first-token");
    expect(secondHeaders.get("authorization")).toBe("Bearer second-token");
    expect(firstHeaders.get("x-client")).toBe("test");
  });

  it("posts typed planner requests as JSON", async () => {
    const fetch = vi.fn<SoullinkFetch>(async (_input, _init) => jsonResponse({ provider: "vad-facs", parameterPlan: [] }));
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch });

    await client.planSpeakingMotion({
      speechText: "hello",
      mode: "fixed-parallel",
      frameCount: 4,
      openAI: { model: "planner-model" }
    });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://example.test/llm/speaking-motion/plan");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      speechText: "hello",
      mode: "fixed-parallel",
      frameCount: 4,
      openAI: { model: "planner-model" }
    });
  });

  it("forwards private emotion tombstones when saving calibration", async () => {
    const fetch = vi.fn<SoullinkFetch>(async (_input, _init) => jsonResponse({ profile: {} }));
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch });

    await client.saveCalibratedProfile({
      modelDir: "avatar",
      privateEmotionMap: { obsoleteEffect: null }
    });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      modelDir: "avatar",
      privateEmotionMap: { obsoleteEffect: null }
    });
  });

  it("creates the model upload manifest and preserves relative paths", async () => {
    let submitted: FormData | undefined;
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      submitted = init?.body as FormData;
      return jsonResponse({ modelDir: "avatar" });
    });
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch: fetch as SoullinkFetch });
    const file = new Blob(["model"], { type: "application/json" });
    Object.defineProperties(file, {
      name: { value: "avatar.model3.json" },
      lastModified: { value: 123 },
      webkitRelativePath: { value: "avatar/avatar.model3.json" }
    });

    await client.uploadLive2DModel({
      files: [file],
      modelDir: "avatar",
      displayName: "Avatar"
    });

    expect(submitted?.get("modelDir")).toBe("avatar");
    expect(submitted?.get("displayName")).toBe("Avatar");
    expect(JSON.parse(String(submitted?.get("manifest")))).toEqual([{
      name: "avatar.model3.json",
      size: 5,
      lastModified: 123,
      relativePath: "avatar/avatar.model3.json"
    }]);
    expect(submitted?.getAll("files")).toHaveLength(1);
  });

  it("surfaces a structured API error", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: "model not found" }, 404));
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch: fetch as SoullinkFetch });

    const error = await client.getModel("missing").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SoullinkApiError);
    expect(error).toMatchObject({
      message: "model not found",
      status: 404,
      path: "/models/missing"
    });
  });

  it("aborts a request with an endpoint-specific timeout", async () => {
    const fetch: SoullinkFetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    const client = new SoullinkApiClient({
      baseURL: "https://example.test",
      fetch,
      timeouts: { embedding: 5 }
    });

    await expect(client.classifyWithEmbedding({ message: "hello" }))
      .rejects.toBeInstanceOf(SoullinkApiTimeoutError);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
