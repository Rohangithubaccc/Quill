// ── Shared types for the multi-provider AI abstraction ─────────────────────
//
// One normalized shape every call site codes against, regardless of which
// provider ends up handling the request. Two implementations sit behind
// this: AnthropicProvider (native Messages API) and
// OpenAICompatibleProvider (the openai SDK pointed at whichever base_url —
// OpenAI itself, Google Gemini's OpenAI-compatible endpoint, NVIDIA NIM,
// Groq, Together, DeepSeek, Mistral, OpenRouter, self-hosted vLLM/Ollama,
// or anything else that speaks the same protocol).

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AICompletionRequest {
  model: string
  maxTokens: number
  system?: string
  messages: AIMessage[]
  temperature?: number
}

export interface AIUsage {
  inputTokens: number
  outputTokens: number
}

export interface AICompletionResult {
  text: string
  usage: AIUsage
}

// Streaming yields text deltas as they arrive, then a final event carrying
// usage once the provider reports it (both Anthropic and OpenAI-compatible
// APIs send usage at/after the end of the stream, not per-chunk).
//
// stopReason is normalized across providers because at least one real call
// site (ai/generate/route.ts) depends on distinguishing "ran out of
// max_tokens mid-generation" from "finished naturally" to warn when output
// was truncated — Anthropic reports this as stop_reason 'max_tokens' vs
// 'end_turn'; OpenAI-compatible APIs report finish_reason 'length' vs
// 'stop'. Both map onto the same three buckets here so callers don't need
// to know which provider actually served the request.
export type AIStopReason = 'max_tokens' | 'end_turn' | 'other'

export type AIStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done'; usage: AIUsage; stopReason: AIStopReason }

export interface AIProviderClient {
  readonly providerLabel: string
  createCompletion(req: AICompletionRequest): Promise<AICompletionResult>
  streamCompletion(req: AICompletionRequest): AsyncGenerator<AIStreamEvent>
}

export type ByokProvider = 'anthropic' | 'openai_compatible'

export interface ValidationResult {
  valid: boolean
  error?: string
}
