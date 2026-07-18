export function smoothDamp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export function smoothingFactor(speed: number, deltaSeconds: number): number {
  return 1 - Math.exp(-Math.max(0, speed) * Math.max(0, deltaSeconds));
}
