import { describe, expect, it, vi } from "vitest";
import type { EmotionIntent } from "@soullink-emotion/engine";
import { SoullinkApiClient, type SoullinkFetch } from "../index";
import {
  createEmbeddingClassifierAdapter,
  createPlannerAdapter,
  createTtsAdapter
} from "../runtimeAdapters";
import { createBrowserTtsAdapter, estimateSpeechDurationFromText } from "../browser";

describe("runtime adapters", () => {
  it("maps runtime planner input and resolves provider settings lazily", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch: SoullinkFetch = async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return jsonResponse({ provider: "vad-facs", parameterPlan: [] });
    };
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch });
    let model = "first-model";
    const planner = createPlannerAdapter({
      client,
      getOpenAI: () => ({ model })
    });

    await planner.planSpeakingMotion?.({
      speechText: "line",
      durationSec: 0,
      mode: "fixed-parallel",
      frameCount: 4,
      characterName: "Amane",
      characterProfile: "profile"
    });
    model = "second-model";
    await planner.planReaction({
      message: "hello",
      conversation: [],
      characterName: "Amane",
      characterProfile: "profile"
    });

    expect(requests[0]).toMatchObject({
      url: "https://example.test/llm/speaking-motion/plan",
      body: { speechText: "line", frameCount: 4, openAI: { model: "first-model" } }
    });
    expect(requests[1]).toMatchObject({
      url: "https://example.test/llm/reaction/plan",
      body: { message: "hello", openAI: { model: "second-model" } }
    });
  });

  it("returns embedding intents through the MessageClassifier port", async () => {
    const intent: EmotionIntent = {
      emotion: "confused",
      variant: "confused",
      intensity: 0.7,
      contextTags: ["question"]
    };
    const fetch = vi.fn(async () => jsonResponse({ intent, initialized: true, exampleCount: 80 }));
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch: fetch as SoullinkFetch });
    const classifier = createEmbeddingClassifierAdapter({ client });

    await expect(classifier.classify("怎么回事")).resolves.toEqual({ intent });
  });

  it("returns environment-neutral TTS bytes and only forwards OpenAI config to CosyVoice", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch: SoullinkFetch = async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/wav" } });
    };
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch });
    const tts = createTtsAdapter({
      client,
      getProvider: () => "cosyvoice2",
      getOpenAI: () => ({ apiKey: "server-forwarded-key" })
    });

    const result = await tts.synthesize("hello", { emotion: "happy" });
    expect(Array.from(new Uint8Array(result.bytes ?? new ArrayBuffer(0)))).toEqual([1, 2, 3]);
    expect(requests[0]).toMatchObject({
      url: "https://example.test/tts/cosyvoice2",
      body: {
        text: "hello",
        emotion: "happy",
        provider: "cosyvoice2",
        openAI: { apiKey: "server-forwarded-key" }
      }
    });
  });

  it("supports injected browser URL and duration helpers", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1])));
    const client = new SoullinkApiClient({ baseURL: "https://example.test", fetch: fetch as SoullinkFetch });
    const probeDuration = vi.fn(async () => 2.75);
    const tts = createBrowserTtsAdapter({
      client,
      createObjectURL: () => "blob:test-audio",
      probeDuration
    });

    await expect(tts.synthesize("hello", {})).resolves.toEqual({
      url: "blob:test-audio",
      durationSec: 2.75
    });
    expect(probeDuration).toHaveBeenCalledWith("blob:test-audio", 0.8);
    expect(estimateSpeechDurationFromText("x".repeat(500))).toBe(30);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" }
  });
}
