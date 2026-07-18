export function estimateMockSpeechDuration(message: string): number {
  const length = Math.max(6, message.trim().length);
  return Math.min(4.6, 1.2 + length * 0.08);
}
