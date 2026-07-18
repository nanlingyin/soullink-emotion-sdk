import type { RandomSource } from "./seededRandom";

export type NumberRange = [number, number];

export function randomRange(range: NumberRange, random: RandomSource): number {
  return range[0] + (range[1] - range[0]) * random();
}

export function pickOne<T>(items: T[], random: RandomSource): T {
  return items[Math.floor(random() * items.length) % items.length];
}
