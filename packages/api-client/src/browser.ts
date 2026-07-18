import type { TtsClient, TtsContext, TtsResult } from "@soullink-emotion/runtime-core";
import type { SoullinkApiClient } from "./SoullinkApiClient";
import type { OpenAIProviderRequestConfig, VoiceProvider } from "./types";

export interface BrowserTtsAdapterOptions {
  client: SoullinkApiClient;
  getOpenAI?: () => OpenAIProviderRequestConfig | undefined;
  getProvider?: (text: string, context: TtsContext) => VoiceProvider;
  createObjectURL?: (blob: Blob) => string;
  probeDuration?: (url: string, fallbackSeconds: number) => Promise<number>;
}

/** Browser TTS adapter with an object URL and a best-effort real clip duration. */
export function createBrowserTtsAdapter(options: BrowserTtsAdapterOptions): TtsClient {
  return {
    async synthesize(text: string, context: TtsContext): Promise<TtsResult> {
      const provider = options.getProvider?.(text, context) ?? "voxcpm2";
      const blob = await options.client.synthesizeVoice({
        text,
        emotion: context.emotion,
        vad: context.vad,
        provider,
        openAI: provider === "cosyvoice2" ? options.getOpenAI?.() : undefined
      });

      const makeURL = options.createObjectURL ?? ((value: Blob) => URL.createObjectURL(value));
      const url = makeURL(blob);
      const fallback = estimateSpeechDurationFromText(text);
      const durationSec = await (options.probeDuration ?? probeAudioDuration)(url, fallback);
      return { url, durationSec };
    }
  };
}

export function estimateSpeechDurationFromText(text: string): number {
  const visibleLength = text.replace(/\s+/gu, "").length;
  return Math.max(0.8, Math.min(30, visibleLength * 0.16));
}

export async function probeAudioDuration(
  url: string,
  fallbackSeconds: number,
  timeoutMs = 1_600
): Promise<number> {
  if (typeof Audio === "undefined") return fallbackSeconds;

  const probe = new Audio(url);
  if (Number.isFinite(probe.duration) && probe.duration > 0) return probe.duration;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    probe.onloadedmetadata = () => {
      clearTimeout(timeout);
      resolve();
    };
  });

  const duration = Number.isFinite(probe.duration) && probe.duration > 0
    ? probe.duration
    : fallbackSeconds;
  probe.onloadedmetadata = null;
  probe.src = "";
  return duration;
}
