import { describe, expect, it } from "vitest";
import {
  computeAdaptationCoverage,
  guessFacsKey,
  isStandardId,
  type CdiParamLike
} from "../AdaptationCoverage";
import type { ModelProfile } from "../ModelProfile";

/** Minimal profile: standard-id targets on some keys, a non-standard numeric id
 *  on others, and a union (standard + non-standard) on blush. No capabilities set
 *  so coverage must derive them. */
function buildProfile(): ModelProfile {
  return {
    modelId: "coverage-fixture",
    displayName: "Coverage Fixture",
    version: "1.0.0",
    modelPath: "/models/coverage/coverage.model3.json",
    parameterMap: {
      headX: { target: "ParamAngleX", mode: "set", scale: 30, min: -30, max: 30 },
      headY: { target: "ParamAngleY", mode: "set", scale: 30, min: -30, max: 30 },
      eyeOpen: { targets: ["ParamEyeLOpen", "ParamEyeROpen"], mode: "set", scale: 1, min: 0, max: 1.2 },
      // non-standard target -> mapped but low confidence
      sweat: { target: "Param79", mode: "set", scale: 1, min: 0, max: 1 },
      // union of standard ParamCheek + non-standard Param84 -> not every target standard -> low
      blush: { targets: ["Param84", "ParamCheek"], mode: "set", scale: 1, min: 0, max: 1 }
    },
    idleConfig: {}
  };
}

/** CDI parameters: every used id, plus two leftovers (one name-guessable). */
const params: CdiParamLike[] = [
  { id: "ParamAngleX", name: "角度X", groupId: "g_head", groupName: "Head" },
  { id: "ParamAngleY", name: "角度Y", groupId: "g_head", groupName: "Head" },
  { id: "ParamEyeLOpen", name: "左眼 开闭", groupId: "g_eye", groupName: "Eye" },
  { id: "ParamEyeROpen", name: "右眼 开闭", groupId: "g_eye", groupName: "Eye" },
  { id: "ParamCheek", name: "脸红", groupId: "g_face", groupName: "Face" },
  { id: "Param84", name: "脸颊泛红", groupId: "g_face", groupName: "Face" },
  { id: "Param79", name: "汗", groupId: "g_face", groupName: "Face" },
  // leftover, name-guessable to tear
  { id: "Param100", name: "眼泪", groupId: "g_face", groupName: "Tears" },
  // leftover, no needle match -> guessedFacsKey undefined
  { id: "ParamHairFront", name: "hair front", groupId: "g_hair", groupName: "Hair" }
];

describe("isStandardId", () => {
  it("recognizes canonical Cubism ids and rejects arbitrary ones", () => {
    expect(isStandardId("ParamAngleX")).toBe(true);
    expect(isStandardId("ParamCheek")).toBe(true);
    expect(isStandardId("Param84")).toBe(false);
    expect(isStandardId("Param79")).toBe(false);
  });
});

describe("guessFacsKey", () => {
  it("hints from id/name/groupName needles", () => {
    expect(guessFacsKey({ id: "x", name: "cheek", groupId: "", groupName: "" })).toBe("blush");
    expect(guessFacsKey({ id: "x", name: "脸红", groupId: "", groupName: "" })).toBe("blush");
    expect(guessFacsKey({ id: "Param100", name: "眼泪", groupId: "", groupName: "Tears" })).toBe("tear");
    expect(guessFacsKey({ id: "x", name: "汗", groupId: "", groupName: "" })).toBe("sweat");
    expect(guessFacsKey({ id: "ParamEyeBallX", name: "眼球X", groupId: "", groupName: "" })).toBe("gazeX");
    expect(guessFacsKey({ id: "x", name: "呼吸", groupId: "", groupName: "" })).toBe("breath");
    expect(guessFacsKey({ id: "ParamHairFront", name: "hair front", groupId: "", groupName: "Hair" })).toBeUndefined();
  });
});

describe("computeAdaptationCoverage", () => {
  it("marks standard-id targets high confidence via the provenance-undefined path", () => {
    const profile = buildProfile();
    const coverage = computeAdaptationCoverage(profile, params, {
      modelDir: "coverage",
      provider: "existing"
      // provenance intentionally omitted -> source "unknown", confidence inferred from isStandardId
    });

    const headX = coverage.perKey.find((k) => k.key === "headX");
    expect(headX).toMatchObject({
      status: "mapped",
      source: "unknown",
      confidence: "high",
      targets: ["ParamAngleX"],
      capability: "headControl"
    });

    const eyeOpen = coverage.perKey.find((k) => k.key === "eyeOpen");
    expect(eyeOpen?.status).toBe("mapped");
    expect(eyeOpen?.confidence).toBe("high");
    expect(eyeOpen?.targets).toEqual(["ParamEyeLOpen", "ParamEyeROpen"]);
  });

  it("marks non-standard and mixed-union targets low confidence", () => {
    const coverage = computeAdaptationCoverage(buildProfile(), params, { modelDir: "coverage" });

    const sweat = coverage.perKey.find((k) => k.key === "sweat");
    expect(sweat?.status).toBe("mapped");
    expect(sweat?.confidence).toBe("low");

    // ParamCheek is standard but Param84 is not -> not every() standard -> low
    const blush = coverage.perKey.find((k) => k.key === "blush");
    expect(blush?.confidence).toBe("low");

    expect(coverage.lowConfidenceKeys).toEqual(expect.arrayContaining(["sweat", "blush"]));
    // low-confidence keys are mapped, so they must NOT also appear as unmapped
    expect(coverage.unmappedKeys).not.toContain("sweat");
    expect(coverage.unmappedKeys).not.toContain("blush");
  });

  it("lists unmapped FACS keys and keeps mapped/unmapped arrays disjoint", () => {
    const coverage = computeAdaptationCoverage(buildProfile(), params, { modelDir: "coverage" });

    expect(coverage.unmappedKeys).toEqual(expect.arrayContaining(["gazeX", "mouthOpen", "headZ"]));
    expect(coverage.unmappedKeys).not.toContain("headX");
    expect(coverage.mappedKeyCount).toBe(5);
    expect(coverage.mappedKeyCount + coverage.unmappedKeys.length).toBe(coverage.facsKeyCount);
  });

  it("reports leftover CDI parameters with name-guessed hints", () => {
    const coverage = computeAdaptationCoverage(buildProfile(), params, { modelDir: "coverage" });

    // 7 of 9 params are referenced by rule targets
    expect(coverage.cdiParameterCount).toBe(9);
    expect(coverage.usedCdiParameterCount).toBe(7);

    const leftoverIds = coverage.unmappedCdiParameters.map((p) => p.id);
    expect(leftoverIds).toEqual(expect.arrayContaining(["Param100", "ParamHairFront"]));
    expect(leftoverIds).not.toContain("ParamAngleX");

    const tearParam = coverage.unmappedCdiParameters.find((p) => p.id === "Param100");
    expect(tearParam?.guessedFacsKey).toBe("tear");
    const hairParam = coverage.unmappedCdiParameters.find((p) => p.id === "ParamHairFront");
    expect(hairParam?.guessedFacsKey).toBeUndefined();
  });

  it("derives capabilities when the profile has none", () => {
    const coverage = computeAdaptationCoverage(buildProfile(), params, { modelDir: "coverage" });
    expect(coverage.schemaVersion).toBe(1);
    expect(coverage.capabilities.headControl).toBe(true);
    expect(coverage.capabilities.blush).toBe(true);
    expect(coverage.capabilities.sweat).toBe(true);
    expect(coverage.capabilities.gazeControl).toBe(false);
  });

  it("counts private emotion targets as used CDI parameters", () => {
    const profile: ModelProfile = {
      ...buildProfile(),
      privateEmotionMap: {
        confusion: { target: "Param100", emotions: ["confused"] }
      }
    };

    const coverage = computeAdaptationCoverage(profile, params, { modelDir: "coverage" });

    expect(coverage.unmappedCdiParameters.map((param) => param.id)).not.toContain("Param100");
    expect(coverage.usedCdiParameterCount).toBe(8);
  });

  it("does not mutate the input profile", () => {
    const profile = buildProfile();
    const before = JSON.parse(JSON.stringify(profile));
    computeAdaptationCoverage(profile, params, { modelDir: "coverage", provider: "manual" });
    expect(profile).toEqual(before);
    // capabilities were absent going in and must stay absent (coverage is response-only)
    expect(profile.capabilities).toBeUndefined();
  });
});
