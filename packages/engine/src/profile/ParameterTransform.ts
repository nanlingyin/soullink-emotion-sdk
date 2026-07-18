import type { ParameterMapRule } from "./ModelProfile";

export type ResponseCurve = "linear" | "easeIn" | "easeOut" | "easeInOut" | "smoothstep";

function hasExpressiveFields(rule: ParameterMapRule): boolean {
  return rule.curve !== undefined
    || rule.gamma !== undefined
    || rule.deadzone !== undefined
    || rule.inputRange !== undefined
    || rule.outputRange !== undefined
    || rule.invertAround !== undefined;
}

function applyCurve(value: number, curve: ResponseCurve | undefined): number {
  switch (curve) {
    case "easeIn":
      return value * value;
    case "easeOut":
      return 1 - (1 - value) * (1 - value);
    case "easeInOut":
      return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
    case "smoothstep":
      return value * value * (3 - 2 * value);
    case "linear":
    default:
      return value;
  }
}

function applyCurveSigned(value: number, curve: ResponseCurve | undefined): number {
  if (value < 0) return -applyCurve(Math.abs(value), curve);
  return applyCurve(value, curve);
}

/**
 * Map a FACS/custom-channel value through one profile rule.
 * Legacy rules intentionally keep the historical compose math byte-for-byte in shape.
 * v2 outputRange remaps the post-mode normalized value, then scale/offset still apply;
 * adapters remain responsible for final min/max clamping.
 */
export function transformRuleValue(value: number, rule: ParameterMapRule): number {
  const safeValue = Number.isFinite(value) ? value : 0;
  const scale = rule.scale ?? 1;
  const offset = rule.offset ?? 0;

  if (!hasExpressiveFields(rule)) {
    if (rule.mode === "inverse") {
      return 1 - safeValue * scale + offset;
    }
    if (rule.mode === "subtract") {
      return -(safeValue * scale) + offset;
    }
    return safeValue * scale + offset;
  }

  let mapped = safeValue;

  if (rule.inputRange) {
    const [inMin, inMax] = rule.inputRange;
    const denominator = inMax - inMin;
    mapped = denominator === 0 ? 0 : (mapped - inMin) / denominator;
  }

  const deadzone = rule.deadzone ?? 0;
  if (deadzone > 0) {
    const magnitude = Math.abs(mapped);
    if (magnitude < deadzone) {
      mapped = 0;
    } else {
      const denominator = 1 - deadzone;
      const rescaled = denominator <= 0 ? 0 : (magnitude - deadzone) / denominator;
      mapped = Math.sign(mapped) * rescaled;
    }
  }

  if (rule.gamma !== undefined && rule.gamma > 0) {
    mapped = Math.sign(mapped) * Math.pow(Math.abs(mapped), rule.gamma);
  }

  mapped = applyCurveSigned(mapped, rule.curve);

  if (rule.mode === "inverse") {
    mapped = (rule.invertAround ?? 1) - mapped;
  } else if (rule.mode === "subtract") {
    mapped = -mapped;
  }

  if (rule.outputRange) {
    const [outMin, outMax] = rule.outputRange;
    mapped = outMin + mapped * (outMax - outMin);
  }

  return mapped * scale + offset;
}
