import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenAICompatibleClientLike } from "@soullink-emotion/planner-openai";
import { Live2DProfileAutoGenerator } from "../Live2DProfileAutoGenerator";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Live2DProfileAutoGenerator", () => {
  it("maps numeric CDI ids by display name without matching CatEar or CheekPuff", async () => {
    const root = await createModel([
      { Id: "Param10", Name: "脸红", GroupId: "face" },
      { Id: "Param9", Name: "眼泪", GroupId: "face" },
      { Id: "ParamCatEarL1", Name: "猫耳L1", GroupId: "ears" },
      { Id: "CheekPuff", Name: "CheekPuff", GroupId: "mouth" },
      { Id: "ParamAngleX", Name: "角度 X", GroupId: "pose" }
    ]);
    const generator = new Live2DProfileAutoGenerator({
      modelsRoot: root,
      modelsBaseUrl: "https://cdn.example.test/models/"
    });

    const result = await generator.ensure({ modelDir: "sample", force: true });

    expect(result.provider).toBe("heuristic");
    expect(result.modelUrl).toBe("https://cdn.example.test/models/sample/sample.model3.json");
    expect(result.profile.parameterMap.blush?.targets).toEqual(["Param10"]);
    expect(result.profile.parameterMap.tear?.targets).toEqual(["Param9"]);
    expect(result.profile.parameterMap.headX?.target).toBe("ParamAngleX");
    expect(ruleTargets(result.profile.parameterMap.blush)).not.toContain("CheekPuff");
    expect(ruleTargets(result.profile.parameterMap.tear)).not.toContain("ParamCatEarL1");
  });

  it("creates declarative private emotion rules for model-specific semantic parameters", async () => {
    const root = await createModel([
      { Id: "Param6", Name: "困惑", GroupId: "face" },
      { Id: "Param7", Name: "星星", GroupId: "face" },
      { Id: "Param8", Name: "生气", GroupId: "face" },
      { Id: "Param10", Name: "脸红", GroupId: "face" }
    ]);
    const generator = new Live2DProfileAutoGenerator({ modelsRoot: root });

    const result = await generator.ensure({ modelDir: "sample", force: true });

    expect(result.profile.privateEmotionMap?.confusionEffect).toMatchObject({
      targets: ["Param6"],
      emotions: ["confused"],
      exclusiveGroup: "face-effect",
      source: "heuristic"
    });
    expect(result.profile.privateEmotionMap?.starEffect?.targets).toEqual(["Param7"]);
    expect(result.profile.privateEmotionMap?.angerEffect?.targets).toEqual(["Param8"]);
    expect(result.profile.privateEmotionMap?.confusionEffect?.targets).not.toContain("Param10");
  });

  it("sanitizes LLM private emotion rules against real CDI ids", async () => {
    const root = await createModel([{ Id: "Param6", Name: "困惑", GroupId: "face" }]);
    const generator = new Live2DProfileAutoGenerator({
      modelsRoot: root,
      client: responseClient({
        parameterMap: {},
        privateEmotionMap: {
          confusionEffect: {
            targets: ["Param6", "Ghost"],
            emotions: ["confused"],
            vadRange: { valence: [-2, 0.4], arousal: [0.2, 3] },
            intensity: 2,
            confidence: 2,
            exclusiveGroup: "face-effect"
          }
        }
      }),
      useConfiguredOpenAI: true
    });

    const result = await generator.ensure({ modelDir: "sample", force: true });

    expect(result.profile.privateEmotionMap?.confusionEffect).toMatchObject({
      targets: ["Param6"],
      vadRange: { valence: [-1, 0.4], arousal: [0.2, 1] },
      intensity: 1,
      confidence: 1,
      source: "llm"
    });
  });

  it("rejects mouth opening private rules but keeps mouth form rules", async () => {
    const root = await createModel([
      { Id: "ParamJawOpen", Name: "下颌开合", GroupId: "mouth" },
      { Id: "ParamMouthForm", Name: "口型", GroupId: "mouth" }
    ]);
    const generator = new Live2DProfileAutoGenerator({
      modelsRoot: root,
      client: responseClient({
        parameterMap: {},
        privateEmotionMap: {
          invalidOpen: { target: "ParamJawOpen", emotions: ["happy"] },
          validForm: { target: "ParamMouthForm", emotions: ["happy"] }
        }
      }),
      useConfiguredOpenAI: true
    });

    const result = await generator.ensure({ modelDir: "sample", force: true });

    expect(result.profile.privateEmotionMap?.invalidOpen).toBeUndefined();
    expect(result.profile.privateEmotionMap?.validForm?.target).toBe("ParamMouthForm");
  });

  it("allows an LLM refinement to delete a false heuristic rule with null", async () => {
    const root = await createModel([
      { Id: "ParamTear", Name: "Tears", GroupId: "face" }
    ]);
    const generator = new Live2DProfileAutoGenerator({
      modelsRoot: root,
      client: deletingClient("tear"),
      useConfiguredOpenAI: true
    });

    const result = await generator.ensure({ modelDir: "sample", force: true });

    expect(result.provider).toBe("openai-compatible");
    expect(result.profile.parameterMap.tear).toBeUndefined();
  });

  it("resolves non-standard left/right names as alternatives instead of requiring every synonym", async () => {
    const root = await createModel([
      { Id: "CustomSmileLeft", Name: "左眼微笑", GroupId: "face" },
      { Id: "CustomSmileRight", Name: "右眼微笑", GroupId: "face" }
    ]);
    const generator = new Live2DProfileAutoGenerator({ modelsRoot: root });

    const result = await generator.ensure({ modelDir: "sample", force: true });

    expect(result.profile.parameterMap.eyeSmile?.targets).toEqual([
      "CustomSmileLeft",
      "CustomSmileRight"
    ]);
  });

  it("keeps only LLM motion bindings that exist in the scanned catalog", async () => {
    const root = await createModel([], { motions: { Idle: [{ File: "idle.motion3.json" }] } });
    const generator = new Live2DProfileAutoGenerator({
      modelsRoot: root,
      client: responseClient({
        parameterMap: {},
        motionMap: {
          happy: { group: "Idle", index: 0, priority: "normal" },
          invalid: { group: "Missing", index: 0 }
        }
      }),
      useConfiguredOpenAI: true
    });

    const result = await generator.ensure({ modelDir: "sample", force: true });

    expect(result.profile.motionMap).toEqual({
      happy: { group: "Idle", index: 0, priority: "normal" }
    });
  });

  it("regenerates when the configured public model URL changes", async () => {
    const root = await createModel([{ Id: "ParamAngleX", Name: "角度 X" }]);
    const first = new Live2DProfileAutoGenerator({ modelsRoot: root, modelsBaseUrl: "/models-a" });
    await first.ensure({ modelDir: "sample", force: true });

    const second = new Live2DProfileAutoGenerator({ modelsRoot: root, modelsBaseUrl: "/models-b" });
    const result = await second.ensure({ modelDir: "sample" });

    expect(result.reason).toBe("stale");
    expect(result.profile.modelPath).toBe("/models-b/sample/sample.model3.json");
  });

  it("refreshes old auto-generated revisions while preserving manual profiles", async () => {
    const root = await createModel([{ Id: "ParamAngleX", Name: "角度 X" }]);
    const generator = new Live2DProfileAutoGenerator({ modelsRoot: root });
    const first = await generator.ensure({ modelDir: "sample", force: true });
    const profilePath = path.join(root, "sample", "soullink.profile.json");

    await fs.writeFile(profilePath, JSON.stringify({
      ...first.profile,
      autoProfile: { ...first.profile.autoProfile, promptVersion: "old-generator" }
    }), "utf8");
    const refreshed = await generator.ensure({ modelDir: "sample" });
    expect(refreshed.reason).toBe("stale");

    await fs.writeFile(profilePath, JSON.stringify({
      ...refreshed.profile,
      autoProfile: {
        ...refreshed.profile.autoProfile,
        provider: "manual",
        promptVersion: "old-generator"
      }
    }), "utf8");
    const manual = await generator.ensure({ modelDir: "sample" });
    expect(manual.reason).toBe("current");
    expect(manual.generated).toBe(false);
  });
});

async function createModel(
  parameters: Array<{ Id: string; Name?: string; GroupId?: string }>,
  options: { motions?: Record<string, Array<{ File: string }>> } = {}
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "soullink-profile-sdk-"));
  temporaryRoots.push(root);
  const directory = path.join(root, "sample");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "sample.model3.json"), JSON.stringify({
    Version: 3,
    FileReferences: {
      DisplayInfo: "sample.cdi3.json",
      ...(options.motions ? { Motions: options.motions } : {})
    }
  }), "utf8");
  await fs.writeFile(path.join(directory, "sample.cdi3.json"), JSON.stringify({
    Version: 3,
    ParameterGroups: [
      { Id: "face", Name: "Face" },
      { Id: "ears", Name: "Ears" },
      { Id: "mouth", Name: "Mouth" },
      { Id: "pose", Name: "Pose" }
    ],
    Parameters: parameters
  }), "utf8");
  for (const entries of Object.values(options.motions ?? {})) {
    for (const motion of entries) {
      await fs.writeFile(path.join(directory, motion.File), JSON.stringify({ Version: 3 }), "utf8");
    }
  }
  return root;
}

function deletingClient(key: string): OpenAICompatibleClientLike {
  return responseClient({ parameterMap: { [key]: null } });
}

function responseClient(payload: unknown): OpenAICompatibleClientLike {
  return {
    config: {
      configured: true,
      baseURL: "https://example.test/v1",
      model: "profile-test",
      timeoutMs: 1000
    },
    isConfigured: () => true,
    createChatCompletion: async () => ({
      id: "profile-test",
      object: "chat.completion",
      created: 0,
      model: "profile-test",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify(payload)
        }
      }]
    })
  };
}

function ruleTargets(rule: { target?: string; targets?: string[] } | undefined): string[] {
  if (!rule) return [];
  return rule.targets?.length ? rule.targets : rule.target ? [rule.target] : [];
}
