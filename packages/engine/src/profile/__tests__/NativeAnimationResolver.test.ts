import { describe, expect, it } from "vitest";
import { resolveNativeAnimation } from "../NativeAnimationResolver";
import { ModelProfileAdapter } from "../ModelProfileAdapter";
import type { ModelProfile, NativeAnimationCatalog } from "../ModelProfile";
import type { EmotionIntent } from "../../reaction/EmotionIntent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(
  emotion: string,
  overrides: Partial<EmotionIntent> = {}
): EmotionIntent {
  return {
    emotion,
    intensity: 0.8,
    contextTags: [],
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    modelId: "test-model",
    displayName: "Test Model",
    version: "1.0.0",
    modelPath: "/models/test/model.model3.json",
    capabilities: {
      headControl: true,
      bodyControl: true,
      eyeBlink: true,
      eyeSmile: true,
      gazeControl: true,
      mouthOpen: true,
      mouthSmile: true,
      browControl: true,
      blush: true,
      tear: true,
      sweat: true,
      breath: true,
    },
    parameterMap: {},
    idleConfig: {},
    ...overrides,
  };
}

/** Catalog with two expressions, each setting one param. */
const TEST_CATALOG: NativeAnimationCatalog = {
  expressions: [
    { name: "loveEyes", file: "expressions/loveEyes.exp3.json", params: ["Param103"] },
    { name: "angry", file: "expressions/angry.exp3.json", params: ["Param85"] },
    { name: "tears", file: "expressions/Tears.exp3.json", params: ["Param100"] },
  ],
  motions: [
    { group: "Idle", index: 0, file: "motions/sleep.motion3.json" },
  ],
};

// ---------------------------------------------------------------------------
// 1. Returns null when profile has no expressionMap
// ---------------------------------------------------------------------------

describe("resolveNativeAnimation – no expressionMap/motionMap", () => {
  it("returns null when profile has neither expressionMap nor motionMap", () => {
    const profile = makeProfile();
    expect(resolveNativeAnimation(profile, makeIntent("affectionate"))).toBeNull();
  });

  it("returns null when expressionMap is an empty object", () => {
    const profile = makeProfile({ expressionMap: {} });
    expect(resolveNativeAnimation(profile, makeIntent("happy"))).toBeNull();
  });

  it("returns null when motionMap is an empty object", () => {
    const profile = makeProfile({ motionMap: {} });
    expect(resolveNativeAnimation(profile, makeIntent("happy"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Composite key lookup: emotion:variant first, then emotion fallback
// ---------------------------------------------------------------------------

describe("resolveNativeAnimation – composite key lookup", () => {
  it("prefers emotion:variant composite key when both composite and plain exist", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        "affectionate": "tears",       // plain fallback
        "affectionate:love": "loveEyes", // composite key
      },
    });

    const directive = resolveNativeAnimation(
      profile,
      makeIntent("affectionate", { variant: "love" })
    );

    expect(directive).not.toBeNull();
    expect(directive!.expression).toBe("loveEyes");
  });

  it("falls back to plain emotion key when composite key is absent", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        affectionate: "loveEyes",
      },
    });

    const directive = resolveNativeAnimation(
      profile,
      makeIntent("affectionate", { variant: "deep" })
    );

    expect(directive).not.toBeNull();
    expect(directive!.expression).toBe("loveEyes");
  });

  it("falls back to plain emotion key when no variant provided", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        angry: "angry",
      },
    });

    const directive = resolveNativeAnimation(profile, makeIntent("angry"));
    expect(directive).not.toBeNull();
    expect(directive!.expression).toBe("angry");
  });

  it("returns null when neither composite nor plain key matches", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        happy: "loveEyes",
      },
    });

    expect(resolveNativeAnimation(profile, makeIntent("sad"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. minIntensity gate
// ---------------------------------------------------------------------------

describe("resolveNativeAnimation – minIntensity gate", () => {
  it("returns directive when intensity meets minIntensity exactly", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        angry: { expression: "angry", minIntensity: 0.5 },
      },
    });

    const directive = resolveNativeAnimation(
      profile,
      makeIntent("angry", { intensity: 0.5 })
    );

    expect(directive).not.toBeNull();
    expect(directive!.expression).toBe("angry");
  });

  it("returns directive when intensity exceeds minIntensity", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        angry: { expression: "angry", minIntensity: 0.3 },
      },
    });

    const directive = resolveNativeAnimation(
      profile,
      makeIntent("angry", { intensity: 0.9 })
    );

    expect(directive).not.toBeNull();
    expect(directive!.expression).toBe("angry");
  });

  it("returns null when intensity is below minIntensity", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        angry: { expression: "angry", minIntensity: 0.6 },
      },
    });

    const directive = resolveNativeAnimation(
      profile,
      makeIntent("angry", { intensity: 0.3 })
    );

    expect(directive).toBeNull();
  });

  it("allows expression when no minIntensity is set (string binding)", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        sad: "tears",
      },
    });

    const directive = resolveNativeAnimation(
      profile,
      makeIntent("sad", { intensity: 0.05 })
    );

    expect(directive).not.toBeNull();
    expect(directive!.expression).toBe("tears");
  });
});

// ---------------------------------------------------------------------------
// 4. Motion lookup from motionMap
// ---------------------------------------------------------------------------

describe("resolveNativeAnimation – motionMap", () => {
  it("resolves a motion directive when motionMap has a matching entry", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      motionMap: {
        idle: { group: "Idle", index: 0, priority: "idle" },
      },
    });

    const directive = resolveNativeAnimation(profile, makeIntent("idle"));
    expect(directive).not.toBeNull();
    expect(directive!.motion).toEqual({ group: "Idle", index: 0, priority: "idle" });
    expect(directive!.expression).toBeNull();
  });

  it("resolves both expression and motion when both maps match", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        sad: "tears",
      },
      motionMap: {
        sad: { group: "Idle", index: 0 },
      },
    });

    const directive = resolveNativeAnimation(profile, makeIntent("sad"));
    expect(directive).not.toBeNull();
    expect(directive!.expression).toBe("tears");
    expect(directive!.motion).toEqual({ group: "Idle", index: 0 });
  });

  it("composite key works in motionMap too", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      motionMap: {
        "idle:deep": { group: "Idle", index: 0, priority: "normal" },
        idle: { group: "Idle", index: 0, priority: "idle" },
      },
    });

    const directiveComposite = resolveNativeAnimation(
      profile,
      makeIntent("idle", { variant: "deep" })
    );
    expect(directiveComposite!.motion!.priority).toBe("normal");

    const directivePlain = resolveNativeAnimation(
      profile,
      makeIntent("idle")
    );
    expect(directivePlain!.motion!.priority).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// 5. suppressParamIds populated from nativeAnimations catalog params
// ---------------------------------------------------------------------------

describe("resolveNativeAnimation – suppressParamIds", () => {
  it("populates suppressParamIds from catalog when expression matches", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        affectionate: "loveEyes",
      },
    });

    const directive = resolveNativeAnimation(profile, makeIntent("affectionate"));
    expect(directive).not.toBeNull();
    expect(directive!.suppressParamIds).toEqual(["Param103"]);
  });

  it("suppressParamIds is empty when expression name is not in catalog", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        mystery: "unknownExpression",
      },
    });

    const directive = resolveNativeAnimation(profile, makeIntent("mystery"));
    expect(directive).not.toBeNull();
    expect(directive!.suppressParamIds).toEqual([]);
  });

  it("suppressParamIds is empty when catalog entry has no params", () => {
    const catalogNoParams: NativeAnimationCatalog = {
      expressions: [
        { name: "noParamsExpr", file: "expressions/noop.exp3.json" },
      ],
    };
    const profile = makeProfile({
      nativeAnimations: catalogNoParams,
      expressionMap: {
        noop: "noParamsExpr",
      },
    });

    const directive = resolveNativeAnimation(profile, makeIntent("noop"));
    expect(directive).not.toBeNull();
    expect(directive!.suppressParamIds).toEqual([]);
  });

  it("suppressParamIds is empty when only motion is resolved (no expression)", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      motionMap: {
        idle: { group: "Idle", index: 0 },
      },
    });

    const directive = resolveNativeAnimation(profile, makeIntent("idle"));
    expect(directive).not.toBeNull();
    expect(directive!.suppressParamIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Token is a positive number and increments on each non-null result
// ---------------------------------------------------------------------------

describe("resolveNativeAnimation – token", () => {
  it("returns distinct tokens for consecutive non-null results", () => {
    const profile = makeProfile({
      nativeAnimations: TEST_CATALOG,
      expressionMap: {
        angry: "angry",
        sad: "tears",
      },
    });

    const d1 = resolveNativeAnimation(profile, makeIntent("angry"));
    const d2 = resolveNativeAnimation(profile, makeIntent("sad"));
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d1!.token).not.toBe(d2!.token);
    expect(typeof d1!.token).toBe("number");
    expect(typeof d2!.token).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 7. Golden backward-compat: profile WITHOUT expressionMap produces IDENTICAL
//    live2dParams from adapter.apply() (no change from pre-C5 behavior).
// ---------------------------------------------------------------------------

describe("Backward-compat: pre-C5 profile unchanged by C5 additions", () => {
  /**
   * Minimal reproduction of the bee profile's parameterMap. We don't need all
   * 25 keys — enough to exercise set/subtract/multi-target paths.
   */
  const beeLikeParameterMap = {
    eyeOpen: { targets: ["ParamEyeLOpen", "ParamEyeROpen"], mode: "set" as const, scale: 1, min: 0, max: 1.2 },
    eyeBlinkL: { target: "ParamEyeLOpen", mode: "subtract" as const, scale: 1, min: 0, max: 1.2 },
    eyeBlinkR: { target: "ParamEyeROpen", mode: "subtract" as const, scale: 1, min: 0, max: 1.2 },
    gazeX: { target: "ParamEyeBallX", mode: "set" as const, scale: 1, min: -1, max: 1 },
    headX: { target: "ParamAngleX", mode: "set" as const, scale: 30, min: -30, max: 30 },
    mouthSmile: { target: "ParamMouthForm", mode: "set" as const, scale: 1, min: -1, max: 1 },
    blush: { targets: ["Param84", "ParamCheek"], mode: "set" as const, scale: 1, min: 0, max: 1 },
    tear: { targets: ["Param100"], mode: "set" as const, scale: 1, min: 0, max: 1 },
  };

  const neutralParams: Record<string, number> = {
    ParamEyeLOpen: 1,
    ParamEyeROpen: 1,
    ParamEyeBallX: 0,
    ParamAngleX: 0,
    ParamMouthForm: 0,
    Param84: 0,
    ParamCheek: 0,
    Param100: 0,
  };

  const profileWithoutExpMap = makeProfile({
    schemaVersion: 2,
    parameterMap: beeLikeParameterMap,
    neutralParams,
    // No expressionMap, no nativeAnimations — this is the "before C5" state.
  });

  // Same parameterMap + neutralParams but now with expressionMap and catalog.
  const profileWithExpMap = makeProfile({
    schemaVersion: 2,
    parameterMap: beeLikeParameterMap,
    neutralParams,
    nativeAnimations: TEST_CATALOG,
    expressionMap: {
      affectionate: "loveEyes",
      angry: "angry",
      sad: "tears",
    },
  });

  const testFACS = {
    eyeOpen: 0.95,
    eyeBlinkL: 0.05,
    gazeX: 0.3,
    headX: 0.2,
    mouthSmile: 0.4,
    blush: 0.6,
    tear: 0.1,
  };

  it("adapter.apply() output is identical with and without expressionMap", () => {
    const adapterWithout = new ModelProfileAdapter(profileWithoutExpMap);
    const adapterWith = new ModelProfileAdapter(profileWithExpMap);

    const paramsWithout = adapterWithout.apply(testFACS);
    const paramsWith = adapterWith.apply(testFACS);

    // Must be bit-for-bit identical.
    expect(paramsWith).toEqual(paramsWithout);
  });

  it("resolveNativeAnimation returns null for profile without expressionMap", () => {
    const result = resolveNativeAnimation(profileWithoutExpMap, makeIntent("affectionate"));
    expect(result).toBeNull();
  });

  it("adapter.apply() on bare profile returns expected golden values", () => {
    const adapter = new ModelProfileAdapter(profileWithoutExpMap);
    const params = adapter.apply(testFACS);

    // eyeOpen=0.95 with scale=1 -> set ParamEyeLOpen=0.95, ParamEyeROpen=0.95
    // eyeBlinkL=0.05 subtracts from ParamEyeLOpen only: 0.95 - 0.05 = 0.90
    // eyeBlinkR is absent from testFACS (defaults to 0): ParamEyeROpen stays 0.95
    expect(params.ParamEyeLOpen).toBeCloseTo(0.90, 10);
    expect(params.ParamEyeROpen).toBeCloseTo(0.95, 10);

    // gazeX=0.3 * scale=1 = 0.3
    expect(params.ParamEyeBallX).toBeCloseTo(0.3, 10);

    // headX=0.2 * scale=30 = 6.0
    expect(params.ParamAngleX).toBeCloseTo(6.0, 10);

    // mouthSmile=0.4 * scale=1 = 0.4
    expect(params.ParamMouthForm).toBeCloseTo(0.4, 10);

    // blush=0.6 -> set Param84=0.6, ParamCheek=0.6
    expect(params.Param84).toBeCloseTo(0.6, 10);
    expect(params.ParamCheek).toBeCloseTo(0.6, 10);

    // tear=0.1 -> Param100=0.1
    expect(params.Param100).toBeCloseTo(0.1, 10);
  });
});
