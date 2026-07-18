import type { SoullinkExternalPlan } from "@soullink-emotion/engine";
import type {
  ClassifyResult,
  MessageClassifier,
  PlannerClient,
  ProactivePlanInput,
  ProactivePlanResult,
  ReactionPlanInput,
  ReflectionPlanInput,
  ReflectionPlanResult,
  SpeakingMotionInput,
  SpeakingMotionResult,
  TtsClient,
  TtsContext,
  TtsResult
} from "@soullink-emotion/runtime-core";
import type { SoullinkApiClient } from "./SoullinkApiClient";
import type { OpenAIProviderRequestConfig, VoiceProvider } from "./types";

export interface PlannerAdapterOptions {
  client: SoullinkApiClient;
  getOpenAI?: () => OpenAIProviderRequestConfig | undefined;
}

export function createPlannerAdapter(options: PlannerAdapterOptions): PlannerClient {
  return {
    planReaction(input: ReactionPlanInput): Promise<SoullinkExternalPlan> {
      return options.client.planReaction({
        message: input.message,
        conversation: input.conversation,
        characterName: input.characterName,
        characterProfile: input.characterProfile,
        vad: input.vad,
        openAI: options.getOpenAI?.()
      });
    },
    planProactive(input: ProactivePlanInput): Promise<ProactivePlanResult> {
      return options.client.planProactiveMessage({
        characterName: input.characterName,
        characterProfile: input.characterProfile,
        proactive: input.proactive,
        conversation: input.conversation,
        reflection: input.reflection,
        vad: input.vad,
        openAI: options.getOpenAI?.()
      });
    },
    planReflection(input: ReflectionPlanInput): Promise<ReflectionPlanResult> {
      return options.client.planReflection({
        conversation: input.conversation,
        vad: input.vad,
        topic: input.topic,
        characterName: input.characterName,
        characterProfile: input.characterProfile,
        openAI: options.getOpenAI?.()
      });
    },
    planSpeakingMotion(input: SpeakingMotionInput): Promise<SpeakingMotionResult> {
      return options.client.planSpeakingMotion({
        speechText: input.speechText,
        durationSec: input.durationSec,
        mode: input.mode,
        frameCount: input.frameCount,
        frameIntervalSec: input.frameIntervalSec,
        availableParameters: input.availableParameters,
        intent: input.intent,
        vad: input.vad,
        expression: input.expression,
        characterName: input.characterName,
        characterProfile: input.characterProfile,
        userMessage: input.userMessage,
        openAI: options.getOpenAI?.()
      });
    }
  };
}

export interface TtsAdapterOptions {
  client: SoullinkApiClient;
  getOpenAI?: () => OpenAIProviderRequestConfig | undefined;
  getProvider?: (text: string, context: TtsContext) => VoiceProvider;
}

/** Environment-neutral TTS adapter. Audio is returned as bytes for a host AudioSink. */
export function createTtsAdapter(options: TtsAdapterOptions): TtsClient {
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
      return { bytes: await blob.arrayBuffer() };
    }
  };
}

export interface EmbeddingClassifierAdapterOptions {
  client: SoullinkApiClient;
  getOpenAI?: () => OpenAIProviderRequestConfig | undefined;
}

export function createEmbeddingClassifierAdapter(options: EmbeddingClassifierAdapterOptions): MessageClassifier {
  return {
    async classify(message: string): Promise<ClassifyResult> {
      const result = await options.client.classifyWithEmbedding({
        message,
        openAI: options.getOpenAI?.()
      });
      return { intent: result.intent };
    }
  };
}
