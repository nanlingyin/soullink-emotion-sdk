import type { ModelProfile } from "./ModelProfile.js";

export const CURRENT_SCHEMA_VERSION = 2;

export function effectiveSchemaVersion(profile: ModelProfile): number {
  return profile.schemaVersion ?? 1;
}

export interface ProfileValidationResult {
  ok: boolean;
  profile: ModelProfile;
  errors: string[];
  warnings: string[];
}

export function validateModelProfile(raw: unknown): ProfileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    errors.push("Profile must be a non-null object");
    return { ok: false, profile: raw as ModelProfile, errors, warnings };
  }

  const r = raw as Record<string, unknown>;

  // Fatal errors
  if (typeof r["modelId"] !== "string" || r["modelId"] === "") {
    errors.push("Missing or invalid field: modelId (string required)");
  }
  if (typeof r["modelPath"] !== "string" || r["modelPath"] === "") {
    errors.push("Missing or invalid field: modelPath (string required)");
  }
  if (
    typeof r["parameterMap"] !== "object" ||
    r["parameterMap"] === null ||
    Array.isArray(r["parameterMap"])
  ) {
    errors.push("Missing or invalid field: parameterMap (object required)");
  }

  // Recoverable warnings
  if (typeof r["displayName"] !== "string" || r["displayName"] === "") {
    warnings.push("Missing or empty field: displayName");
  }
  if (typeof r["version"] !== "string" || r["version"] === "") {
    warnings.push("Missing or empty field: version");
  }
  if (r["capabilities"] === undefined || r["capabilities"] === null) {
    warnings.push("Missing field: capabilities — will be derived at runtime");
  }

  // Warn on non-string target/targets inside parameterMap rules
  if (
    typeof r["parameterMap"] === "object" &&
    r["parameterMap"] !== null &&
    !Array.isArray(r["parameterMap"])
  ) {
    const pm = r["parameterMap"] as Record<string, unknown>;
    for (const [key, rule] of Object.entries(pm)) {
      if (typeof rule === "object" && rule !== null) {
        const ruleObj = rule as Record<string, unknown>;
        if (
          ruleObj["target"] !== undefined &&
          typeof ruleObj["target"] !== "string"
        ) {
          warnings.push(`parameterMap.${key}.target is not a string`);
        }
        if (Array.isArray(ruleObj["targets"])) {
          const badCount = (ruleObj["targets"] as unknown[]).filter(
            (t) => typeof t !== "string"
          ).length;
          if (badCount > 0) {
            warnings.push(
              `parameterMap.${key}.targets contains ${badCount} non-string entry/entries`
            );
          }
        }
      }
    }
  }

  if (r["privateEmotionMap"] !== undefined) {
    if (
      typeof r["privateEmotionMap"] !== "object" ||
      r["privateEmotionMap"] === null ||
      Array.isArray(r["privateEmotionMap"])
    ) {
      errors.push("Invalid field: privateEmotionMap (object required when present)");
    } else {
      for (const [key, mapping] of Object.entries(r["privateEmotionMap"] as Record<string, unknown>)) {
        if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
          warnings.push(`privateEmotionMap.${key} is not an object`);
          continue;
        }
        const record = mapping as Record<string, unknown>;
        if (record["target"] !== undefined && typeof record["target"] !== "string") {
          warnings.push(`privateEmotionMap.${key}.target is not a string`);
        }
        if (Array.isArray(record["targets"]) && record["targets"].some((target) => typeof target !== "string")) {
          warnings.push(`privateEmotionMap.${key}.targets contains a non-string entry`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    profile: raw as ModelProfile,
    errors,
    warnings,
  };
}

export function migrateProfile(raw: unknown): {
  profile: ModelProfile;
  fromVersion: number;
  toVersion: number;
  changes: string[];
} {
  const result = validateModelProfile(raw);
  if (!result.ok) {
    throw new Error(result.errors[0]);
  }
  const fromVersion = effectiveSchemaVersion(result.profile);
  const toVersion = fromVersion;
  // NOTE: actual v1→v2 upgrade is NOT implemented here — that is upgradeToV2 in C4-T2 (future task).
  // This function exists so callers have a stable import path.
  return { profile: result.profile, fromVersion, toVersion, changes: [] };
}
