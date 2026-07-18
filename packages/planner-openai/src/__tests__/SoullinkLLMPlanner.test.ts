import { describe, expect, it } from "vitest";
import type {
  OpenAIChatCompletionResponse,
  OpenAIClientConfig,
  OpenAIClientOptions,
  OpenAICompatibleClientLike
} from "../openAICompatibleTypes";
import { SoullinkLLMPlanner } from "../SoullinkLLMPlanner";

class StaticClient implements OpenAICompatibleClientLike {
  readonly config: OpenAIClientConfig = {
    configured: true,
    baseURL: "https://planner.test/v1",
    model: "fake-model",
    timeoutMs: 1000
  };

  isConfigured(_options?: OpenAIClientOptions): boolean {
    return true;
  }

  async createChatCompletion(): Promise<OpenAIChatCompletionResponse> {
    return {
      id: "fake",
      object: "chat.completion",
      created: 0,
      model: "fake-model",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            emotion: "happy",
            variant: "bright_smile",
            intensity: 0.9,
            contextTags: ["user_good_news"],
            replyDraft: "太棒了！",
            vadTarget: { valence: 0.9, arousal: 0.8, dominance: 0.2 },
            vadDelta: { valence: 0.9, arousal: 0.8, dominance: 0.2 },
            actionPlan: [
              {
                time: 0,
                duration: 0.3,
                label: "empty-effect",
                intensity: 0.6,
                facs: {},
                actionUnits: {}
              },
              {
                time: 0.3,
                duration: 0.3,
                label: "unknown-effect",
                intensity: 0.6,
                facs: { unknownChannel: 0.8 },
                actionUnits: { au999: 0.8 }
              },
              {
                time: 0.6,
                duration: 0.5,
                label: "bright-smile",
                intensity: 0.9,
                facs: { eyeSquint: 0.7 },
                actionUnits: { au12LipCornerPuller: 0.9 }
              }
            ]
          })
        },
        finish_reason: "stop"
      }]
    };
  }
}

describe("SoullinkLLMPlanner", () => {
  it("filters action beats without usable FACS or action-unit channels", async () => {
    const planner = new SoullinkLLMPlanner(new StaticClient());

    const plan = await planner.plan({ message: "我通过考试了！" });

    expect(plan.provider).toBe("openai-compatible");
    expect(plan.actionPlan).toEqual([{
      time: 0.6,
      duration: 0.5,
      label: "bright-smile",
      intensity: 0.9,
      facs: { eyeSquint: 0.7 },
      actionUnits: { au12LipCornerPuller: 0.9 }
    }]);
  });
});
