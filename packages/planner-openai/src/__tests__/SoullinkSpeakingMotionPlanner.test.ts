import { describe, expect, it, vi } from "vitest";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIClientConfig,
  OpenAIClientOptions,
  OpenAICompatibleClientLike
} from "../openAICompatibleTypes";
import {
  isMouthOrJawOpenParameter,
  resolveSpeakingMotionFrameCount,
  resolveSpeakingMotionGenerationConfig,
  SoullinkSpeakingMotionPlanner
} from "../SoullinkSpeakingMotionPlanner";

const parameters = {
  ParamAngleX: { min: -30, max: 30, default: 0, name: "Head X" },
  ParamEyeBallX: { min: -1, max: 1, default: 0, name: "Gaze X" },
  ParamBrowLY: { min: -1, max: 1, default: 0, name: "Left brow" },
  ParamMouthForm: { min: -1, max: 1, default: 0, name: "Mouth form" }
};

class QueueClient implements OpenAICompatibleClientLike {
  readonly config: OpenAIClientConfig = {
    configured: true,
    baseURL: "https://planner.test/v1",
    model: "fake-model",
    timeoutMs: 1000
  };
  readonly calls: OpenAIChatCompletionRequest[] = [];

  constructor(private responses: Array<string | Error>) {}

  isConfigured(_options?: OpenAIClientOptions): boolean {
    return true;
  }

  async createChatCompletion(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    this.calls.push(request);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("Missing fake response");
    return {
      id: "fake",
      object: "chat.completion",
      created: 0,
      model: "fake-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: next },
        finish_reason: "stop"
      }]
    };
  }
}

function actionResponse(frameCount: number): string {
  return JSON.stringify({
    motionPlan: Array.from({ length: frameCount }, (_, frameIndex) => ({
      frameIndex,
      action: "轻轻转头并看向用户",
      emphasis: "test"
    }))
  });
}

function parameterResponse(frameCount: number): string {
  return JSON.stringify({
    parameterPlan: Array.from({ length: frameCount }, (_, index) => ({
      time: 99,
      duration: 99,
      label: "frame-" + index,
      parameters: {
        ParamAngleX: index + 2,
        ParamEyeBallX: 0.25,
        ParamBrowLY: 0.2
      }
    }))
  });
}

describe("speaking motion frame strategies", () => {
  it("uses fixed mode without requiring TTS duration and keeps two stages enabled", async () => {
    const client = new QueueClient([actionResponse(3), parameterResponse(3)]);
    const planner = new SoullinkSpeakingMotionPlanner(client, {
      mode: "fixed-parallel",
      fixedFrameCount: 3,
      frameIntervalSec: 0.75
    });

    const plan = await planner.plan({
      speechText: "现在就开始规划动作",
      availableParameters: parameters
    });

    expect(plan.provider).toBe("openai-compatible");
    expect(plan.parameterPlan).toHaveLength(3);
    expect(plan.parameterPlan.map((frame) => frame.time)).toEqual([0, 0.75, 1.5]);
    expect(plan.parameterPlan.every((frame) => frame.duration === 0.75)).toBe(true);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "soullink_speaking_motion_actions" }
    });
  });

  it("derives duration frames with caps and accepts request overrides", () => {
    const durationConfig = resolveSpeakingMotionGenerationConfig({
      mode: "duration",
      frameIntervalSec: 2,
      minFrameCount: 2,
      maxFrameCount: 4
    });

    expect(resolveSpeakingMotionFrameCount({ durationSec: 5.1 }, durationConfig)).toBe(3);
    expect(resolveSpeakingMotionFrameCount({ durationSec: 99 }, durationConfig)).toBe(4);
    expect(resolveSpeakingMotionFrameCount({ durationSec: 99, frameCount: 2 }, durationConfig)).toBe(2);
  });

  it("uses request frameCount and frameIntervalSec over constructor defaults", async () => {
    const client = new QueueClient([actionResponse(2), parameterResponse(2)]);
    const planner = new SoullinkSpeakingMotionPlanner(client, {
      mode: "duration",
      frameIntervalSec: 2,
      maxFrameCount: 20
    });

    const plan = await planner.plan({
      speechText: "覆盖策略",
      durationSec: 10,
      frameCount: 2,
      frameIntervalSec: 0.5,
      availableParameters: parameters
    });

    expect(plan.parameterPlan.map((frame) => frame.time)).toEqual([0, 0.5]);
    expect(plan.debug).toMatchObject({
      requestedFrameCount: 2,
      frameIntervalSec: 0.5
    });
  });

  it("runs duration mode with the derived frame count", async () => {
    const client = new QueueClient([actionResponse(3), parameterResponse(3)]);
    const planner = new SoullinkSpeakingMotionPlanner(client, {
      mode: "duration",
      frameIntervalSec: 2,
      minFrameCount: 1,
      maxFrameCount: 10
    });

    const plan = await planner.plan({
      speechText: "按真实语音时长规划",
      durationSec: 5.1,
      availableParameters: parameters
    });

    expect(plan.provider).toBe("openai-compatible");
    expect(plan.parameterPlan).toHaveLength(3);
    expect(plan.parameterPlan.map((frame) => frame.time)).toEqual([0, 2, 4]);
    expect(plan.debug?.generationMode).toBe("duration");
  });
});

describe("speaking motion fallback and mouth filtering", () => {
  it("returns vad-facs with an empty parameter plan when no API key is configured", async () => {
    const fetchSpy = vi.fn();
    const planner = new SoullinkSpeakingMotionPlanner({ fetch: fetchSpy });
    const plan = await planner.plan({
      speechText: "不调用模型",
      availableParameters: parameters
    });

    expect(plan.provider).toBe("vad-facs");
    expect(plan.parameterPlan).toEqual([]);
    expect(plan.debug?.fallbackCode).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not synthesize local parameter motion when the LLM fails", async () => {
    const client = new QueueClient([
      new Error("upstream down"),
      new Error("upstream down"),
      new Error("upstream down")
    ]);
    const planner = new SoullinkSpeakingMotionPlanner(client);
    const plan = await planner.plan({
      speechText: "模型失败",
      availableParameters: parameters
    });

    expect(plan.provider).toBe("vad-facs");
    expect(plan.parameterPlan).toEqual([]);
    expect(plan.debug?.fallbackCode).toBe("action_planning_failed");
  });

  it("filters only mouth/jaw opening while preserving mouth form and lip shapes", async () => {
    const available = {
      ...parameters,
      ParamMouthOpenY: { min: 0, max: 1, default: 0, name: "Mouth open" },
      ParamJawOpen: { min: 0, max: 1, default: 0, name: "Jaw open" },
      ParamMouthSmile: { min: 0, max: 1, default: 0, name: "Smile" },
      ParamLipPucker: { min: 0, max: 1, default: 0, name: "Lip pucker" },
      ParamLipShape: { min: -1, max: 1, default: 0, name: "Lip shape" },
      ParamMouthDetail: { min: -1, max: 1, default: 0, name: "Custom mouth detail", groupName: "Mouth open / lip sync" }
    };
    const client = new QueueClient([
      actionResponse(1),
      JSON.stringify({
        parameterPlan: [{
          time: 0,
          duration: 1,
          label: "mouth-details",
          parameters: {
            ParamMouthOpenY: 0.9,
            ParamJawOpen: 0.8,
            ParamMouthForm: 0.7,
            ParamMouthSmile: 0.6,
            ParamLipPucker: 0.5,
            ParamLipShape: -0.4,
            ParamMouthDetail: 0.3,
            ParamAngleX: 5
          }
        }]
      })
    ]);
    const planner = new SoullinkSpeakingMotionPlanner(client, { fixedFrameCount: 1 });
    const plan = await planner.plan({
      speechText: "保留非开合口型",
      availableParameters: available
    });
    const output = plan.parameterPlan[0]?.parameters;

    expect(plan.provider).toBe("openai-compatible");
    expect(output).not.toHaveProperty("ParamMouthOpenY");
    expect(output).not.toHaveProperty("ParamJawOpen");
    expect(output).toMatchObject({
      ParamMouthForm: expect.any(Number),
      ParamMouthSmile: expect.any(Number),
      ParamLipPucker: expect.any(Number),
      ParamLipShape: expect.any(Number),
      ParamMouthDetail: expect.any(Number)
    });
    expect(isMouthOrJawOpenParameter("ParamMouthForm")).toBe(false);
    expect(isMouthOrJawOpenParameter("ParamLipPucker")).toBe(false);
    expect(isMouthOrJawOpenParameter("ParamMouthForm", { groupName: "嘴巴开合" })).toBe(false);
  });
});
