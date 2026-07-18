import { describe, expect, it } from "vitest";
import { validateModelProfile } from "../ModelProfileSchema";

describe("validateModelProfile", () => {
  it("accepts a minimal valid profile", () => {
    const result = validateModelProfile({
      modelId: "test-model",
      displayName: "Test Model",
      version: "1.0.0",
      modelPath: "models/test.model3.json",
      parameterMap: {},
      idleConfig: {},
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("errors when parameterMap is missing", () => {
    const result = validateModelProfile({
      modelId: "test-model",
      displayName: "Test Model",
      version: "1.0.0",
      modelPath: "models/test.model3.json",
      idleConfig: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Missing or invalid field: parameterMap (object required)");
  });
});
