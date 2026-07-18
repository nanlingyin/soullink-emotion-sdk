import { clamp } from "../utils/clamp";
import type { FACSKey, Live2DParamState, PartialFACSLikeState } from "../facs/FACSLikeState";
import { applyFallbackStrategies } from "./FallbackStrategy";
import { deriveNeutralParams } from "./deriveProfileDefaults";
import type { ModelProfile, ParameterMapRule } from "./ModelProfile";
import { effectiveSchemaVersion } from "./ModelProfileSchema";
import { transformRuleValue } from "./ParameterTransform";

interface ParameterContribution {
  target: string;
  rule: ParameterMapRule;
  mapped: number;
}

export class ModelProfileAdapter {
  constructor(private profile: ModelProfile) {}

  setProfile(profile: ModelProfile) {
    this.profile = profile;
  }

  getProfile(): ModelProfile {
    return this.profile;
  }

  apply(facs: PartialFACSLikeState, customChannels?: Record<string, number>): Live2DParamState {
    if (effectiveSchemaVersion(this.profile) < 2) {
      return this.applyLegacy(facs);
    }

    return this.applyV2(facs, customChannels ?? {});
  }

  private applyLegacy(facs: PartialFACSLikeState): Live2DParamState {
    const normalized = applyFallbackStrategies(facs, this.profile);
    const effectiveNeutral = this.profile.neutralParams ?? deriveNeutralParams(this.profile);
    const result: Live2DParamState = { ...effectiveNeutral };

    for (const key of Object.keys(this.profile.parameterMap) as FACSKey[]) {
      const rule = this.profile.parameterMap[key];
      if (!rule) continue;

      const raw = normalized[key] ?? 0;
      const targets = this.getTargets(rule);
      if (targets.length === 0) continue;

      const mapped = this.mapValue(raw, rule, false);
      for (const target of targets) {
        if (rule.mode === "set" || result[target] === undefined) {
          result[target] = this.clampRuleValue(mapped, rule);
        } else {
          result[target] += mapped;
          result[target] = this.clampRuleValue(result[target], rule);
        }
      }
    }

    return result;
  }

  private applyV2(facs: PartialFACSLikeState, customChannels: Record<string, number>): Live2DParamState {
    const normalized = applyFallbackStrategies(facs, this.profile);
    const effectiveNeutral = this.profile.neutralParams ?? deriveNeutralParams(this.profile);
    const result: Live2DParamState = { ...effectiveNeutral };
    const contributions: ParameterContribution[] = [];

    for (const key of Object.keys(this.profile.parameterMap) as FACSKey[]) {
      const rule = this.profile.parameterMap[key];
      if (!rule) continue;

      const raw = normalized[key] ?? 0;
      const mapped = transformRuleValue(raw, rule);
      for (const target of this.getTargets(rule)) {
        contributions.push({ target, rule, mapped });
      }
    }

    for (const [channel, rule] of Object.entries(this.profile.customParams ?? {})) {
      const raw = customChannels[channel] ?? 0;
      const mapped = transformRuleValue(raw, rule);
      for (const target of this.getTargets(rule)) {
        contributions.push({ target, rule, mapped });
      }
    }

    for (const contribution of contributions) {
      if (contribution.rule.mode === "add" || contribution.rule.mode === "subtract") continue;
      result[contribution.target] = this.clampRuleValue(contribution.mapped, contribution.rule);
    }

    for (const contribution of contributions) {
      if (contribution.rule.mode !== "add" && contribution.rule.mode !== "subtract") continue;
      result[contribution.target] = this.clampRuleValue((result[contribution.target] ?? 0) + contribution.mapped, contribution.rule);
    }

    return result;
  }

  private getTargets(rule: ParameterMapRule): string[] {
    if (rule.targets?.length) return rule.targets;
    return rule.target ? [rule.target] : [];
  }

  private mapValue(value: number, rule: ParameterMapRule, shouldClamp = true): number {
    const scale = rule.scale ?? 1;
    const offset = rule.offset ?? 0;
    let mapped = value;

    if (rule.mode === "inverse") {
      mapped = 1 - value * scale;
    } else if (rule.mode === "subtract") {
      mapped = -(value * scale);
    } else {
      mapped = value * scale;
    }

    mapped += offset;
    return shouldClamp ? this.clampRuleValue(mapped, rule) : mapped;
  }

  private clampRuleValue(value: number, rule: ParameterMapRule): number {
    return clamp(value, rule.min, rule.max);
  }
}
