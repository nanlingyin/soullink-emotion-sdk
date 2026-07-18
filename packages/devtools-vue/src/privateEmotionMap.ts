import type { PrivateEmotionMap, PrivateEmotionMapping } from "@soullink-emotion/engine";
import type { PrivateEmotionMapPatch } from "./types";

export function clonePrivateEmotionMap(map: PrivateEmotionMap | undefined): PrivateEmotionMap {
  return JSON.parse(JSON.stringify(map ?? {})) as PrivateEmotionMap;
}

/** Build a calibration patch, including null tombstones for deleted rules. */
export function buildPrivateEmotionMapPatch(
  original: PrivateEmotionMap | undefined,
  current: PrivateEmotionMap | undefined
): PrivateEmotionMapPatch {
  const before = original ?? {};
  const after = current ?? {};
  const patch: PrivateEmotionMapPatch = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[key];
    const next = after[key];
    if (!next) {
      if (previous) patch[key] = null;
      continue;
    }
    if (!previous || !equalMapping(previous, next)) {
      patch[key] = {
        ...cloneMapping(next),
        source: "manual",
        confidence: next.confidence ?? 1
      };
    }
  }

  return patch;
}

function cloneMapping(mapping: PrivateEmotionMapping): PrivateEmotionMapping {
  return JSON.parse(JSON.stringify(mapping)) as PrivateEmotionMapping;
}

function equalMapping(previous: PrivateEmotionMapping, next: PrivateEmotionMapping): boolean {
  const normalizedPrevious = { ...previous };
  const normalizedNext = { ...next };
  if (normalizedPrevious.source !== "manual") delete normalizedPrevious.source;
  if (normalizedNext.source !== "manual") delete normalizedNext.source;
  return JSON.stringify(normalizedPrevious) === JSON.stringify(normalizedNext);
}
