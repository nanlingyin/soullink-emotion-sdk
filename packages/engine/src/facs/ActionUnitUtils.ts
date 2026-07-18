import { clamp } from "../utils/clamp";
import {
  actionUnitDefinitions,
  actionUnitKeys,
  type FACSActionUnitKey,
  type FACSActionUnitState,
  type PartialFACSActionUnitState
} from "./FACSActionUnitState";
import { createDefaultActionUnitState } from "./defaultActionUnitState";

const directionalKeys = new Set<FACSActionUnitKey>([
  "gazeX",
  "gazeY",
  "headX",
  "headY",
  "headZ",
  "bodyX",
  "bodyY",
  "bodyZ"
]);

const rangeByKey = Object.fromEntries(
  actionUnitDefinitions.map((definition) => [definition.key, [definition.min, definition.max] as [number, number]])
) as Record<FACSActionUnitKey, [number, number]>;

export function actionUnitRangeForKey(key: FACSActionUnitKey): [number, number] {
  return rangeByKey[key] ?? (directionalKeys.has(key) ? [-1, 1] : [0, 1]);
}

export function clampActionUnitValue(key: FACSActionUnitKey, value: number): number {
  const [min, max] = actionUnitRangeForKey(key);
  return clamp(value, min, max);
}

export function clampActionUnitState<T extends PartialFACSActionUnitState>(state: T): T {
  const result = { ...state } as T;

  for (const key of Object.keys(result) as FACSActionUnitKey[]) {
    const value = result[key];
    if (typeof value === "number") {
      result[key] = clampActionUnitValue(key, value) as T[typeof key];
    }
  }

  return result;
}

export function normalizeActionUnits(partial: PartialFACSActionUnitState): FACSActionUnitState {
  const result = createDefaultActionUnitState();

  for (const key of actionUnitKeys) {
    const value = partial[key];
    result[key] = clampActionUnitValue(key, value ?? result[key]);
  }

  return result;
}

export function addActionUnits(
  base: PartialFACSActionUnitState,
  overlay: PartialFACSActionUnitState,
  weight = 1
): PartialFACSActionUnitState {
  const result = { ...base };

  for (const key of Object.keys(overlay) as FACSActionUnitKey[]) {
    const value = overlay[key];
    if (typeof value === "number") {
      result[key] = ((result[key] ?? 0) + value * weight) as never;
    }
  }

  return clampActionUnitState(result);
}
