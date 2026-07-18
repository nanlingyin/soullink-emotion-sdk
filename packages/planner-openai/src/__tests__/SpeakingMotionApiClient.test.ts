import { describe, expect, it, vi } from "vitest";
import { createSpeakingMotionApiClient } from "../SpeakingMotionApiClient";

describe("createSpeakingMotionApiClient", () => {
  it("uses explicit transport config and never forwards OpenAI credentials", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Response(JSON.stringify({ provider: "vad-facs", parameterPlan: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const client = createSpeakingMotionApiClient({
      baseURL: "https://backend.test/",
      fetch,
      headers: { "X-App": "test" },
      timeoutMs: 1000
    });

    await client.plan({
      speechText: "hello",
      mode: "fixed",
      frameCount: 2,
      openAI: { apiKey: "must-not-leave-browser" }
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://backend.test/llm/speaking-motion/plan");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json", "X-App": "test" });
    expect(String(init?.body)).not.toContain("must-not-leave-browser");
    expect(String(init?.body)).not.toContain("openAI");
  });
});
