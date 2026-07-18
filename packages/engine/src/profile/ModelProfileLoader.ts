import type { ProfileLoadResult } from "./ModelProfile.js";
import { validateModelProfile } from "./ModelProfileSchema.js";

export async function loadModelProfile(url: string, fetcher: typeof fetch = fetch): Promise<ProfileLoadResult> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to load model profile: ${response.status} ${response.statusText}`);
  }

  const raw: unknown = await response.json();
  const validation = validateModelProfile(raw);
  if (!validation.ok) {
    throw new Error(`Invalid model profile at ${url}: ${validation.errors[0]}`);
  }
  for (const w of validation.warnings) {
    console.warn(`[SoullinkProfile] ${w}`);
  }
  return {
    profile: validation.profile,
    sourceUrl: url
  };
}
