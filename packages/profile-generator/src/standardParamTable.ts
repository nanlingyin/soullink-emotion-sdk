import type { FACSKey, MappingSource, ParameterBlendMode } from "@soullink-emotion/engine";

// Re-export provenance with the table so consumers have a single import site.
export type { MappingSource };

/**
 * Canonical Cubism 4 mapping for one FACS key. The numeric fields
 * (mode/scale/min/max) mirror the constants used by
 * Live2DProfileAutoGenerator.createHeuristicProfile exactly, so this table is a
 * faithful record of the shipped heuristic — it is data, not a second source of
 * truth for the emitted rule shapes.
 */
export interface StandardParamSpec {
  ids?: string[];
  pair?: { left: string[]; right: string[] };
  group?: "EyeBlink" | "LipSync" | "MouthOpen";
  mode: ParameterBlendMode;
  scale: number;
  min: number;
  max: number;
}

/**
 * Standard-ID-first mapping table. Keys that are name-only or subtract-derived
 * (tear, sweat, mouthFrown, mouthPucker, eyeBlinkL, eyeBlinkR, eyeSquint) are
 * intentionally absent — they are never resolved from the canonical id table.
 */
export const STANDARD_PARAM_TABLE: Partial<Record<FACSKey, StandardParamSpec>> = {
  eyeOpen: {
    group: "EyeBlink",
    pair: { left: ["ParamEyeLOpen"], right: ["ParamEyeROpen"] },
    mode: "set",
    scale: 1,
    min: 0,
    max: 1.2
  },
  eyeSmile: {
    pair: { left: ["ParamEyeLSmile"], right: ["ParamEyeRSmile"] },
    mode: "set",
    scale: 1,
    min: 0,
    max: 1
  },
  gazeX: { ids: ["ParamEyeBallX"], mode: "set", scale: 1, min: -1, max: 1 },
  gazeY: { ids: ["ParamEyeBallY"], mode: "set", scale: 1, min: -1, max: 1 },
  headX: { ids: ["ParamAngleX"], mode: "set", scale: 30, min: -30, max: 30 },
  headY: { ids: ["ParamAngleY"], mode: "set", scale: 30, min: -30, max: 30 },
  headZ: { ids: ["ParamAngleZ"], mode: "set", scale: 30, min: -30, max: 30 },
  bodyX: { ids: ["ParamBodyAngleX"], mode: "set", scale: 12, min: -12, max: 12 },
  bodyY: { ids: ["ParamBodyAngleY"], mode: "set", scale: 12, min: -12, max: 12 },
  bodyZ: { ids: ["ParamBodyAngleZ"], mode: "set", scale: 12, min: -12, max: 12 },
  mouthSmile: { ids: ["ParamMouthForm"], mode: "set", scale: 1, min: -1, max: 1 },
  mouthOpen: {
    group: "LipSync",
    ids: ["ParamMouthOpenY"],
    mode: "set",
    scale: 1,
    min: 0,
    max: 1
  },
  browInnerUp: {
    pair: { left: ["ParamBrowLY"], right: ["ParamBrowRY"] },
    mode: "set",
    scale: 1,
    min: -1,
    max: 1
  },
  browOuterUp: {
    pair: { left: ["ParamBrowLAngle"], right: ["ParamBrowRAngle"] },
    mode: "set",
    scale: 0.9,
    min: -1,
    max: 1
  },
  browDown: {
    pair: { left: ["ParamBrowLForm"], right: ["ParamBrowRForm"] },
    mode: "set",
    scale: -0.85,
    min: -1,
    max: 1
  },
  blush: { ids: ["ParamCheek"], mode: "set", scale: 1, min: 0, max: 1 },
  breath: { ids: ["ParamBreath"], mode: "set", scale: 1, min: 0, max: 1 }
};

type GroupLike = { Target?: string; Name?: string; Ids?: string[] };

/**
 * Resolve a FACS key to concrete parameter ids using the standard-ID-first
 * strategy, WITHOUT the CDI name-needle fallback (callers own that step):
 *
 *   1. model's own standard-named Group (Target "Parameter") -> "standard-group"
 *   2. canonical standard id(s) from the table -> "standard-id"
 *   3. otherwise undefined (caller falls back to name matching, then unmapped)
 *
 * Never name-based, so it can never displace a name-resolved shipped mapping.
 */
export function resolveStandard(
  key: FACSKey,
  params: ReadonlyArray<{ id: string }>,
  groups: ReadonlyArray<GroupLike>
): { ids: string[]; source: "standard-group" | "standard-id" } | undefined {
  const spec = STANDARD_PARAM_TABLE[key];
  if (!spec) return undefined;

  const paramIds = new Set(params.map((param) => param.id));

  // 1. Prefer the model's own declared standard group (e.g. EyeBlink / LipSync).
  if (spec.group) {
    const group = groups.find(
      (candidate) => candidate.Target === "Parameter" && candidate.Name === spec.group
    );
    const groupIds = (group?.Ids ?? []).filter((id) => paramIds.has(id));
    if (groupIds.length > 0) {
      return { ids: groupIds, source: "standard-group" };
    }
  }

  // 2. Fall back to the canonical standard id(s). Require every listed id so a
  //    model that is missing one side (e.g. only the left brow) is left to the
  //    caller's name matching instead of emitting a lopsided standard mapping.
  const candidateIds = spec.pair ? [...spec.pair.left, ...spec.pair.right] : spec.ids ?? [];
  if (candidateIds.length > 0 && candidateIds.every((id) => paramIds.has(id))) {
    return { ids: [...candidateIds], source: "standard-id" };
  }

  return undefined;
}
