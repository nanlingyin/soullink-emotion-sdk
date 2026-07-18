import { describe, expect, it } from "vitest";
import {
  buildMotionParameters,
  deriveCDIUrl,
  loadCDIParameterMeta,
  parseCDIParameterMeta,
  resolveCDIUrl,
  resolveRelativeURL,
  type Live2DMetadataFetch
} from "../motionParameters";

describe("Live2D parameter metadata", () => {
  it("indexes CDI parameter names and group names by real parameter id", () => {
    expect(parseCDIParameterMeta({
      Version: 3,
      ParameterGroups: [{ Id: "ParamGroup", Name: "Effects" }],
      Parameters: [{ Id: "Param10", GroupId: "ParamGroup", Name: "脸红" }]
    })).toEqual({
      Param10: {
        name: "脸红",
        groupId: "ParamGroup",
        groupName: "Effects"
      }
    });
  });

  it("resolves model3 DisplayInfo with an injected fetch client", async () => {
    const requested: string[] = [];
    const fetchMetadata: Live2DMetadataFetch = async (url) => {
      requested.push(url);
      return {
        ok: true,
        async json() {
          return { FileReferences: { DisplayInfo: "meta/avatar.cdi3.json" } };
        }
      };
    };

    await expect(resolveCDIUrl("models/avatar/avatar.model3.json", {
      fetch: fetchMetadata,
      documentBaseUrl: "https://assets.example.test/app/"
    })).resolves.toBe("https://assets.example.test/app/models/avatar/meta/avatar.cdi3.json");
    expect(requested).toEqual(["models/avatar/avatar.model3.json"]);
  });

  it("loads and parses CDI metadata independently from the renderer", async () => {
    const fetchMetadata: Live2DMetadataFetch = async (url) => ({
      ok: true,
      async json() {
        if (url.endsWith("model3.json")) return { FileReferences: { DisplayInfo: "avatar.cdi3.json" } };
        return { Parameters: [{ Id: "Param6", Name: "困惑" }] };
      }
    });

    await expect(loadCDIParameterMeta("https://cdn.example.test/avatar.model3.json", {
      fetch: fetchMetadata
    })).resolves.toEqual({
      Param6: { name: "困惑", groupId: undefined, groupName: undefined }
    });
  });

  it("exposes deterministic URL fallbacks", () => {
    expect(deriveCDIUrl("https://cdn.example.test/a.model3.json?v=2")).toBe(
      "https://cdn.example.test/a.cdi3.json"
    );
    expect(deriveCDIUrl("https://cdn.example.test/a.json")).toBeNull();
    expect(resolveRelativeURL(
      "models/a.model3.json",
      "../meta/a.cdi3.json",
      "https://cdn.example.test/app/"
    )).toBe("https://cdn.example.test/app/meta/a.cdi3.json");
  });

  it("combines CDI labels with Cubism Core ranges", () => {
    const result = buildMotionParameters({
      internalModel: {
        coreModel: {
          getParameterCount: () => 2,
          getParameterId: (index) => ["ParamAngleX", "Param10"][index]!,
          getParameterMinimumValue: (index) => [-30, 0][index]!,
          getParameterMaximumValue: (index) => [30, 1][index]!,
          getParameterDefaultValue: (index) => [40, 0][index]!
        }
      }
    }, {
      Param10: { name: "脸红", groupName: "Effects" }
    });

    expect(result.ParamAngleX).toMatchObject({ min: -30, max: 30, default: 30 });
    expect(result.Param10).toEqual({
      name: "脸红",
      groupId: undefined,
      groupName: "Effects",
      min: 0,
      max: 1,
      default: 0
    });
  });
});
