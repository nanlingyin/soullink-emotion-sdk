import { clamp } from "../utils/clamp";
import { lerp } from "../utils/lerp";
import { createDefaultFACSState, defaultFACSState } from "./defaultFACSState";
import type { FACSKey, FACSLikeState, PartialFACSLikeState } from "./FACSLikeState";

const directionalKeys = new Set<FACSKey>([
  "gazeX",
  "gazeY",
  "headX",
  "headY",
  "headZ",
  "bodyX",
  "bodyY",
  "bodyZ"
]);

export const facsKeys = Object.keys(createDefaultFACSState()) as FACSKey[];

export function facsRangeForKey(key: FACSKey): [number, number] {
  if (directionalKeys.has(key)) return [-1, 1];
  if (key === "eyeOpen") return [0, 1.25];
  return [0, 1];
}

export function clampFACSValue(key: FACSKey, value: number): number {
  const [min, max] = facsRangeForKey(key);
  return clamp(value, min, max);
}

export function normalizeFACS(partial: PartialFACSLikeState): FACSLikeState {
  const result = createDefaultFACSState();

  for (const key of facsKeys) {
    const value = partial[key];
    result[key] = clampFACSValue(key, value ?? result[key]);
  }

  return result;
}

export function clampFACSState<T extends PartialFACSLikeState>(state: T): T {
  const result = { ...state } as T;

  for (const key of Object.keys(result) as FACSKey[]) {
    const value = result[key];
    if (typeof value === "number") {
      result[key] = clampFACSValue(key, value) as T[typeof key];
    }
  }

  return result;
}

export function mergeFACS(base: PartialFACSLikeState, overlay: PartialFACSLikeState): PartialFACSLikeState {
  return clampFACSState({ ...base, ...overlay });
}

export function addFACS(base: PartialFACSLikeState, overlay: PartialFACSLikeState, weight = 1): PartialFACSLikeState {
  const result = { ...base };

  for (const key of Object.keys(overlay) as FACSKey[]) {
    const value = overlay[key];
    if (typeof value === "number") {
      result[key] = ((result[key] ?? 0) + value * weight) as never;
    }
  }

  return clampFACSState(result);
}

export function scaleFACS(state: PartialFACSLikeState, scale: number): PartialFACSLikeState {
  const result: PartialFACSLikeState = {};

  for (const key of Object.keys(state) as FACSKey[]) {
    const value = state[key];
    if (typeof value === "number") result[key] = value * scale;
  }

  return clampFACSState(result);
}

export function scaleFACSFromNeutral(state: PartialFACSLikeState, scale: number): PartialFACSLikeState {
  const result: PartialFACSLikeState = {};

  for (const key of Object.keys(state) as FACSKey[]) {
    const value = state[key];
    if (typeof value === "number") {
      result[key] = lerp(defaultFACSState[key], value, scale);
    }
  }

  return clampFACSState(result);
}

export function interpolateFACS(
  from: PartialFACSLikeState,
  to: PartialFACSLikeState,
  t: number
): PartialFACSLikeState {
  const result: PartialFACSLikeState = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]) as Set<FACSKey>;

  for (const key of keys) {
    result[key] = lerp(from[key] ?? 0, to[key] ?? 0, t);
  }

  return clampFACSState(result);
}
