import { clamp01 } from "./clamp";

export type EasingName = "linear" | "easeIn" | "easeOut" | "easeInOut";

export function ease(name: EasingName, t: number): number {
  const x = clamp01(t);

  if (name === "easeIn") return x * x;
  if (name === "easeOut") return 1 - (1 - x) * (1 - x);
  if (name === "easeInOut") return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

  return x;
}
