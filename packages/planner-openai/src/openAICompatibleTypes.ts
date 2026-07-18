export type OpenAIChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface OpenAIChatMessage {
  role: OpenAIChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAIJsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export interface OpenAIJsonObjectResponseFormat {
  type: "json_object";
}

export interface OpenAITextResponseFormat {
  type: "text";
}

export type OpenAIResponseFormat =
  | OpenAIJsonSchemaResponseFormat
  | OpenAIJsonObjectResponseFormat
  | OpenAITextResponseFormat;

export interface OpenAIChatCompletionRequest {
  model?: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: OpenAIResponseFormat;
  stream?: false;
}

export interface OpenAIChatCompletionChoice {
  index: number;
  message: OpenAIChatMessage;
  finish_reason?: string;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAIClientOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  organization?: string;
  project?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface OpenAIClientConfig {
  configured: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
}

export interface OpenAICompatibleClientLike {
  readonly config: OpenAIClientConfig;
  isConfigured(options?: OpenAIClientOptions): boolean;
  createChatCompletion(
    request: OpenAIChatCompletionRequest,
    options?: OpenAIClientOptions
  ): Promise<OpenAIChatCompletionResponse>;
}
