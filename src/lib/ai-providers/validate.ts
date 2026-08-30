// ── Provider key validation ──────────────────────────────────────────────
//
// Anthropic keys consistently start with "sk-ant-", so that's still checked
// as a fast, free pre-check before spending an API call on an obvious typo.
// No such universal prefix exists across the openai_compatible universe —
// OpenAI keys start "sk-", NVIDIA NIM keys start "nvapi-", Google API keys
// start "AIza", Groq keys start "gsk_", and plenty of self-hosted or
// enterprise-proxied endpoints accept whatever string the operator chose.
// Enforcing a prefix there would be exactly the kind of "we only really
// support one shape of key" gate this rework exists to remove — so
// openai_compatible validation skips straight to the one universal test
// that actually works for any of them: try a minimal real request and see
// whether it authenticates.

import { AnthropicProvider } from './anthropic-provider'
import { OpenAICompatibleProvider } from './openai-compatible-provider'
import type { ByokProvider, ValidationResult } from './types'

export async function validateProviderKey(
  provider: ByokProvider,
  apiKey: string,
  baseUrl: string | null,
  model: string,
): Promise<ValidationResult> {
  if (!apiKey || apiKey.trim().length < 8) {
    return { valid: false, error: 'That key looks too short to be real.' }
  }
  if (!model || model.trim().length === 0) {
    return { valid: false, error: 'Choose a model to use with this key.' }
  }

  if (provider === 'anthropic') {
    if (!apiKey.startsWith('sk-ant-')) {
      return { valid: false, error: 'Anthropic API keys start with "sk-ant-". Double-check you copied the whole key.' }
    }
    try {
      const client = new AnthropicProvider(apiKey)
      await client.createCompletion({ model, maxTokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      return { valid: true }
    } catch (err: any) {
      return describeError(err)
    }
  }

  // openai_compatible
  if (!baseUrl || baseUrl.trim().length === 0) {
    return { valid: false, error: 'A base URL is required for this provider.' }
  }
  try {
    // eslint-disable-next-line no-new -- validates the URL is well-formed; throws SyntaxError otherwise
    new URL(baseUrl)
  } catch {
    return { valid: false, error: 'That doesn\'t look like a valid URL.' }
  }

  try {
    const client = new OpenAICompatibleProvider(apiKey, baseUrl)
    await client.createCompletion({ model, maxTokens: 1, messages: [{ role: 'user', content: 'hi' }] })
    return { valid: true }
  } catch (err: any) {
    return describeError(err)
  }
}

// Rate-limited (429) means the key itself authenticated fine — Anthropic
// and OpenAI-compatible backends alike only rate-limit requests that
// already got past auth. Anything else is a genuine validation failure.
function describeError(err: any): ValidationResult {
  const status = err?.status ?? err?.response?.status
  if (status === 429) return { valid: true }
  if (status === 401) return { valid: false, error: 'This key was rejected — double-check it was copied correctly.' }
  if (status === 403) return { valid: false, error: 'This key doesn\'t have permission to use this model.' }
  if (status === 404) return { valid: false, error: 'Model or endpoint not found — check the model name and base URL.' }
  return { valid: false, error: err?.message ?? 'Could not validate this key — please try again.' }
}
