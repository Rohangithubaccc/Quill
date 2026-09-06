// ── Anthropic provider ───────────────────────────────────────────────────
//
// Wraps @anthropic-ai/sdk behind the shared AIProviderClient interface.
// This is the only provider that speaks Anthropic's native Messages API
// directly rather than going through the OpenAI-compatible path — Claude
// doesn't expose an OpenAI-compatible endpoint the way OpenAI/Gemini/NVIDIA
// NIM/etc. do, so it needs its own translation layer.

import Anthropic from '@anthropic-ai/sdk'
import type {
  AICompletionRequest,
  AICompletionResult,
  AIProviderClient,
  AIStopReason,
  AIStreamEvent,
} from './types'

function toAnthropicMessages(req: AICompletionRequest) {
  return req.messages.map(m => ({ role: m.role, content: m.content }))
}

// Anthropic's stop_reason values that mean "cut off by the length limit"
// vs. "finished on its own" — normalized to the shared AIStopReason bucket.
function normalizeStopReason(stopReason: string | null | undefined): AIStopReason {
  if (stopReason === 'max_tokens') return 'max_tokens'
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'end_turn'
  return 'other'
}

export class AnthropicProvider implements AIProviderClient {
  readonly providerLabel = 'Anthropic'
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async createCompletion(req: AICompletionRequest): Promise<AICompletionResult> {
    const res = await this.client.messages.create({
      model:       req.model,
      max_tokens:  req.maxTokens,
      system:      req.system,
      messages:    toAnthropicMessages(req),
      temperature: req.temperature,
    })
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
    return {
      text,
      usage: {
        inputTokens:  res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      },
    }
  }

  async *streamCompletion(req: AICompletionRequest): AsyncGenerator<AIStreamEvent> {
    const stream = this.client.messages.stream({
      model:       req.model,
      max_tokens:  req.maxTokens,
      system:      req.system,
      messages:    toAnthropicMessages(req),
      temperature: req.temperature,
    })

    let inputTokens  = 0
    let outputTokens = 0
    let stopReason: string | null | undefined = null

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text_delta', text: event.delta.text }
      }
      if (event.type === 'message_start' && event.message.usage) {
        inputTokens = event.message.usage.input_tokens
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason
      }
    }

    yield {
      type: 'done',
      usage: { inputTokens, outputTokens },
      stopReason: normalizeStopReason(stopReason),
    }
  }
}
