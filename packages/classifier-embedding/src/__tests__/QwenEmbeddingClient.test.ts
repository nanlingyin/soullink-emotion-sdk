import { describe, expect, it, vi } from "vitest";
import {
  QwenEmbeddingClient,
  QwenEmbeddingClientNotConfiguredError,
  type EmbeddingFetch
} from "../QwenEmbeddingClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("QwenEmbeddingClient", () => {
  it("has no implicit API key configuration", async () => {
    const fetcher = vi.fn<EmbeddingFetch>();
    const client = new QwenEmbeddingClient({ fetch: fetcher });

    expect(client.config).toEqual({
      configured: false,
      baseURL: "https://api.openai.com/v1",
      model: "Qwen/Qwen3-VL-Embedding-8B",
      timeoutMs: 30_000
    });
    expect(client.getCacheKey()).toBe("openai-compatible:https://api.openai.com/v1:Qwen/Qwen3-VL-Embedding-8B");
    await expect(client.embed("hello")).rejects.toBeInstanceOf(
      QwenEmbeddingClientNotConfiguredError
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses injected fetch and sorts batch results by response index", async () => {
    const fetcher = vi.fn<EmbeddingFetch>().mockResolvedValue(jsonResponse({
      object: "list",
      data: [
        { object: "embedding", embedding: [0, 1], index: 1 },
        { object: "embedding", embedding: [1, 0], index: 0 }
      ],
      model: "test-model"
    }));
    const client = new QwenEmbeddingClient({
      baseURL: "https://embedding.example/v1/",
      apiKey: "secret",
      model: "test-model",
      fetch: fetcher,
      headers: { "X-Client": "soullink" }
    });

    await expect(client.batchEmbed(["first", "second"])).resolves.toEqual([
      [1, 0],
      [0, 1]
    ]);
    expect(fetcher).toHaveBeenCalledOnce();

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://embedding.example/v1/embeddings");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Authorization": "Bearer secret",
      "Content-Type": "application/json",
      "X-Client": "soullink"
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "test-model",
      input: ["first", "second"],
      encoding_format: "float"
    });
  });

  it("surfaces provider response details without exposing the API key", async () => {
    const fetcher = vi.fn<EmbeddingFetch>().mockResolvedValue(
      new Response("quota exceeded", { status: 429 })
    );
    const client = new QwenEmbeddingClient({ apiKey: "do-not-leak", fetch: fetcher });

    expect(client.config).not.toHaveProperty("apiKey");
    await expect(client.embed("hello")).rejects.toThrow(
      "Embedding API failed with 429: quota exceeded"
    );
  });
});
