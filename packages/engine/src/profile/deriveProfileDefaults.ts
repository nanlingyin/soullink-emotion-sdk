import type { FACSKey } from "../facs/FACSLikeState";
import type { ModelProfile, ParameterMapRule } from "./ModelProfile";

/** Return the FACS key families that share a smoothing value */
export function smoothingForFACS(key: FACSKey): number {
  if (key === "mouthOpen") return 24;
  if (key.startsWith("eye")) return 26;
  if (key.startsWith("gaze")) return 11;
  if (key.startsWith("head")) return 8;
  if (key.startsWith("body")) return 6;
  if (key === "blush" || key === "tear") return 4;
  if (key === "sweat" || key === "breath") return 5;
  return 12;
}

function ruleTargets(rule: ParameterMapRule): string[] {
  return rule.targets?.length ? rule.targets : rule.target ? [rule.target] : [];
}

type ProfileRules = Pick<ModelProfile, "parameterMap" | "customParams">;

/** Derive neutral parameter values from the profile's parameterMap and customParams.
 *  eyeOpen targets → 1, breath target → 0.5, all others → 0.
 *  Returns {} if parameterMap/customParams are empty. */
export function deriveNeutralParams(profile: Pick<ModelProfile, "parameterMap"> & Partial<Pick<ModelProfile, "customParams">>): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [facsKey, rule] of Object.entries(profile.parameterMap) as Array<[FACSKey, ParameterMapRule]>) {
    for (const target of ruleTargets(rule)) {
      if (result[target] !== undefined) continue;
      if (facsKey === "eyeOpen") result[target] = 1;
      else if (facsKey === "breath") result[target] = 0.5;
      else result[target] = 0;
    }
  }

  for (const rule of Object.values(profile.customParams ?? {})) {
    for (const target of ruleTargets(rule)) {
      if (result[target] !== undefined) continue;
      result[target] = 0;
    }
  }

  return result;
}

/** Derive per-parameter smoothing values from the profile's parameterMap and customParams. */
export function deriveParameterSmoothing(profile: ProfileRules): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [facsKey, rule] of Object.entries(profile.parameterMap) as Array<[FACSKey, ParameterMapRule]>) {
    const smoothing = smoothingForFACS(facsKey);
    for (const target of ruleTargets(rule)) {
      result[target] = Math.max(result[target] ?? 0, smoothing);
    }
  }

  for (const rule of Object.values(profile.customParams ?? {})) {
    for (const target of ruleTargets(rule)) {
      result[target] = Math.max(result[target] ?? 0, 12);
    }
  }

  return result;
}

/** Derive per-parameter {min, max} ranges from the profile's parameterMap/customParams (for gain clamping). */
export function deriveParameterRanges(profile: ProfileRules): Record<string, { min?: number; max?: number }> {
  const ranges: Record<string, { min?: number; max?: number }> = {};

  for (const rule of [
    ...Object.values(profile.parameterMap),
    ...Object.values(profile.customParams ?? {})
  ]) {
    if (!rule) continue;
    const targets = ruleTargets(rule);

    for (const target of targets) {
      const existing = ranges[target] ?? {};
      ranges[target] = {
        min: existing.min === undefined ? rule.min : rule.min === undefined ? existing.min : Math.min(existing.min, rule.min),
        max: existing.max === undefined ? rule.max : rule.max === undefined ? existing.max : Math.max(existing.max, rule.max)
      };
    }
  }

  return ranges;
}
