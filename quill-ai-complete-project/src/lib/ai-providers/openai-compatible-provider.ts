// ── OpenAI-compatible provider ───────────────────────────────────────────
//
// One implementation, parameterized by baseURL, covers OpenAI itself,
// Google Gemini (official OpenAI-compatible endpoint:
// generativelanguage.googleapis.com/v1beta/openai/), NVIDIA NIM
// (integrate.api.nvidia.com/v1), Groq, Together AI, Fireworks, DeepSeek,
// Mistral, OpenRouter, and self-hosted endpoints (vLLM, Ollama) — anything
// that implements the standard /v1/chat/completions protocol. This is what
// makes "bring whichever provider's key you want" tractable without a
// bespoke SDK integration per brand.
//
// max_tokens (not max_completion_tokens) is used deliberately — it's the
// parameter every OpenAI-compatible backend in the list above actually
// implements. max_completion_tokens is a newer, OpenAI-specific addition
// for their o-series reasoning models; assuming third-party endpoints
// support it would break the generic case this provider exists for.

import { safeFetch } from '@/lib/url-safety'
import type {
  AICompletionRequest,
  AICompletionResult,
  AIProviderClient,
  AIStopReason,
  AIStreamEvent,
} from './types'

// The base URL here comes directly from a workspace's own BYOK settings —
// attacker-controlled input by this app's own threat model (any workspace
// owner can type anything into it). Handing that straight to the openai
// SDK's default fetch would let a workspace point Quill.AI's own server at
// internal infrastructure — cloud metadata endpoints, localhost, other
// services on the same private network — and use it as a proxy on every
// single generation request, not just once. This is exactly the class of
// bug already fixed elsewhere in this codebase for webhook delivery and
// WordPress publishing (src/lib/url-safety.ts) — reusing that same
// protection here rather than re-deriving a weaker one inline. The openai
// SDK supports a `fetch` constructor override specifically for this kind
// of substitution (confirmed against the installed v4.104.0 types before
// relying on it).
const ssrfSafeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  return safeFetch(url, init)
}

function toOpenAIMessages(req: AICompletionRequest) {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  for (const m of req.messages) messages.push({ role: m.role, content: m.content })
  return messages
}

// OpenAI-protocol finish_reason values, normalized to the shared bucket —
// 'length' means the response was cut off by max_tokens; 'stop' means it
// finished naturally. Third-party backends occasionally use their own
// values here too (seen 'eos' from some self-hosted vLLM configs) — those
// fall through to 'other' rather than being misread as truncation.
function normalizeFinishReason(reason: string | null | undefined): AIStopReason {
  if (reason === 'length') return 'max_tokens'
  if (reason === 'stop') return 'end_turn'
  return 'other'
}

export class OpenAICompatibleProvider implements AIProviderClient {
  readonly providerLabel: string
  private apiKey: string
  private baseURL?: string

  constructor(apiKey: string, baseURL?: string, label?: string) {
    this.apiKey  = apiKey
    this.baseURL = baseURL
    this.providerLabel = label ?? (baseURL ? new URL(baseURL).hostname : 'OpenAI')
  }

  // Dynamic import matches this codebase's established lazy-instantiation
  // convention (see src/inngest/functions.ts's DALL-E call) — importing
  // the openai package must never run, or throw, at module load time.
  private async getClient() {
    const OpenAI = (await import('openai')).default
    return new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL, fetch: ssrfSafeFetch })
  }

  async createCompletion(req: AICompletionRequest): Promise<AICompletionResult> {
    const client = await this.getClient()
    const res = await client.chat.completions.create({
      model:       req.model,
      max_tokens:  req.maxTokens,
      messages:    toOpenAIMessages(req),
      temperature: req.temperature,
      stream:      false,
    })
    const choice = res.choices[0]
    return {
      text: choice?.message?.content ?? '',
      usage: {
        inputTokens:  res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
    }
  }

  async *streamCompletion(req: AICompletionRequest): AsyncGenerator<AIStreamEvent> {
    const client = await this.getClient()
    const stream = await client.chat.completions.create({
      model:       req.model,
      max_tokens:  req.maxTokens,
      messages:    toOpenAIMessages(req),
      temperature: req.temperature,
      stream:      true,
      // Without this, usage is omitted from streamed responses entirely on
      // OpenAI's own API (and most compatible backends follow the same
      // convention) — needed for the same cost/credit accounting parity
      // the Anthropic provider gets for free from message_start/delta.
      stream_options: { include_usage: true },
    })

    let inputTokens  = 0
    let outputTokens = 0
    let finishReason: string | null | undefined = null

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) yield { type: 'text_delta', text: delta }

      const reason = chunk.choices?.[0]?.finish_reason
      if (reason) finishReason = reason

      // Present only on the final chunk when stream_options.include_usage
      // is set — some third-party backends omit it even so, in which case
      // usage stays 0 rather than the stream throwing.
      if (chunk.usage) {
        inputTokens  = chunk.usage.prompt_tokens ?? 0
        outputTokens = chunk.usage.completion_tokens ?? 0
      }
    }

    yield {
      type: 'done',
      usage: { inputTokens, outputTokens },
      stopReason: normalizeFinishReason(finishReason),
    }
  }
}
