import { AnthropicProvider } from './anthropic-provider'
import { OpenAICompatibleProvider } from './openai-compatible-provider'
import type { AIProviderClient, ByokProvider } from './types'

export function createProviderClient(
  provider: ByokProvider,
  apiKey: string,
  baseUrl?: string | null,
): AIProviderClient {
  if (provider === 'anthropic') return new AnthropicProvider(apiKey)
  return new OpenAICompatibleProvider(apiKey, baseUrl ?? undefined)
}

export * from './types'
export { validateProviderKey } from './validate'
