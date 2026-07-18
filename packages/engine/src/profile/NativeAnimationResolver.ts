import type { EmotionIntent } from "../reaction/EmotionIntent";
import type {
  ExpressionBinding,
  ModelProfile,
  MotionBinding,
  NativeAnimationDirective,
} from "./ModelProfile";

/**
 * Module-level monotonic counter used to generate unique tokens.
 * The token is used by the renderer to detect when the directive changes so it
 * only calls model.expression() / model.motion() on actual transitions.
 */
let _token = 0;

/**
 * Resolves the active NativeAnimationDirective for a given EmotionIntent
 * against the profile's expressionMap / motionMap.
 *
 * Returns null when:
 *   - The profile has neither an expressionMap nor a motionMap, OR
 *   - No entry in the maps matches the intent (including minIntensity gates).
 *
 * Lookup order for both maps:
 *   1. `<emotion>:<variant>` composite key (when intent.variant is present)
 *   2. `<emotion>` plain key fallback
 *
 * suppressParamIds is populated from the matching expression's catalog entry
 * (nativeAnimations.expressions[].params). It is empty when no expression is
 * active or the catalog entry has no params list.
 *
 * KEY COMPAT RULE: profiles without expressionMap/motionMap return null here,
 * so snapshot.nativeAnimation stays null and adapter.apply() produces IDENTICAL
 * live2dParams output — no change from pre-C5 behavior.
 */
export function resolveNativeAnimation(
  profile: ModelProfile,
  intent: EmotionIntent
): NativeAnimationDirective | null {
  const hasExpressionMap =
    profile.expressionMap !== undefined &&
    Object.keys(profile.expressionMap).length > 0;
  const hasMotionMap =
    profile.motionMap !== undefined &&
    Object.keys(profile.motionMap).length > 0;

  if (!hasExpressionMap && !hasMotionMap) return null;

  // Composite key takes precedence over plain emotion key.
  const compositeKey =
    intent.variant !== undefined && intent.variant !== ""
      ? `${intent.emotion}:${intent.variant}`
      : undefined;

  // --- Expression resolution ---
  let expressionName: string | null = null;

  const expressionMap = profile.expressionMap ?? {};
  const rawBinding: ExpressionBinding | string | undefined =
    (compositeKey !== undefined ? expressionMap[compositeKey] : undefined) ??
    expressionMap[intent.emotion];

  if (rawBinding !== undefined) {
    const name =
      typeof rawBinding === "string" ? rawBinding : rawBinding.expression;
    const minIntensity =
      typeof rawBinding === "object" ? rawBinding.minIntensity : undefined;
    if (minIntensity === undefined || intent.intensity >= minIntensity) {
      expressionName = name;
    }
  }

  // --- Motion resolution ---
  const motionMap = profile.motionMap ?? {};
  const motionBinding: MotionBinding | null =
    (compositeKey !== undefined ? motionMap[compositeKey] : undefined) ??
    motionMap[intent.emotion] ??
    null;

  // Nothing to drive.
  if (expressionName === null && motionBinding === null) return null;

  // --- suppressParamIds from nativeAnimations catalog ---
  const suppressParamIds: string[] = [];
  if (expressionName !== null && profile.nativeAnimations?.expressions) {
    const catalogEntry = profile.nativeAnimations.expressions.find(
      (entry) => entry.name === expressionName
    );
    if (catalogEntry?.params) {
      suppressParamIds.push(...catalogEntry.params);
    }
  }

  return {
    token: ++_token,
    expression: expressionName,
    motion: motionBinding,
    suppressParamIds,
  };
}
