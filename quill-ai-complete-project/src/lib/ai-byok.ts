// ── Hybrid BYOK (Bring Your Own Key) resolver — any provider ───────────────
//
// Every AI route gets its client from getAIClientForWorkspace() instead of
// instantiating a provider SDK directly. This keeps "which key, which
// provider, which model do we use?" in one place:
//
//   - Workspace has use_own_ai_key = true AND a stored, decryptable key
//     → use the workspace's own provider account, at the model they chose.
//     Quill.AI pays nothing for these tokens.
//   - Otherwise (no key, opted out, or the key fails to decrypt/validate)
//     → fall back to the platform's own key, at the platform's own
//     configured model. The request still succeeds; we just log why BYOK
//     wasn't used so the workspace owner can see it in Settings → API Keys.
//
// The platform default is itself just configuration now, not a hardcoded
// provider — PLATFORM_AI_PROVIDER / PLATFORM_AI_API_KEY /
// PLATFORM_AI_BASE_URL / PLATFORM_AI_MODEL. Originally this pointed
// directly at `new Anthropic(...)`, which meant the whole app was
// unusable without an Anthropic key specifically, even though the actual
// generation code has no real dependency on Anthropic — every call site
// already goes through the same provider-agnostic interface BYOK uses.
// Hardcoding the platform path to one brand while making every workspace's
// own path fully flexible was the same "you must use this one" problem
// BYOK was built to solve, just moved up one level instead of removed.
// Same reasoning VS Code/Cursor apply to their own model selection: a
// sensible default, freely replaceable, never a hard requirement on one
// vendor. PLATFORM_AI_PROVIDER defaults to 'anthropic' when unset — Claude
// is still the intended eventual default — but deploying today with a
// different provider configured (or none yet) no longer means editing
// code, only environment variables.

import { createSupabaseAdmin } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/utils'
import { createProviderClient } from './ai-providers'
import type { AIProviderClient, ByokProvider } from './ai-providers/types'

function getPlatformProviderConfig(): { provider: ByokProvider; apiKey: string; baseUrl: string | null; model: string } {
  const provider = (process.env.PLATFORM_AI_PROVIDER as ByokProvider | undefined) ?? 'anthropic'
  const apiKey   = process.env.PLATFORM_AI_API_KEY
  const model    = process.env.PLATFORM_AI_MODEL
  const baseUrl  = process.env.PLATFORM_AI_BASE_URL ?? null

  if (!apiKey || !model) {
    // Thrown only when an actual request tries to use the platform path —
    // never at import time, so a deploy with these unset still builds and
    // serves every non-AI route fine (same lazy-singleton discipline as
    // the Resend/Stripe clients elsewhere in this codebase).
    throw new Error(
      'Platform AI provider is not configured — set PLATFORM_AI_API_KEY and PLATFORM_AI_MODEL ' +
      '(and PLATFORM_AI_PROVIDER + PLATFORM_AI_BASE_URL if not using Anthropic). ' +
      'Workspaces with their own BYOK key configured are unaffected.'
    )
  }
  if (provider === 'openai_compatible' && !baseUrl) {
    throw new Error('PLATFORM_AI_PROVIDER=openai_compatible requires PLATFORM_AI_BASE_URL to be set.')
  }
  return { provider, apiKey, baseUrl, model }
}

let _platformClient: AIProviderClient | null = null
let _platformModel: string | null = null
function getPlatformClient(): { client: AIProviderClient; model: string } {
  if (!_platformClient || !_platformModel) {
    const cfg = getPlatformProviderConfig()
    _platformClient = createProviderClient(cfg.provider, cfg.apiKey, cfg.baseUrl)
    _platformModel  = cfg.model
  }
  return { client: _platformClient, model: _platformModel }
}

export interface ResolvedAIClient {
  client:  AIProviderClient
  isByok:  boolean
  model:   string
}

// workspaceId may be null for routes with no workspace context (e.g. the
// public /try demo) — those always run on the platform key. No
// per-call-site default model anymore — every route uses whichever model
// the resolved provider (platform config or the workspace's own BYOK
// choice) actually specifies, rather than each route hardcoding its own
// literal. One consequence worth being upfront about: the platform path
// previously used a separate, cheaper model for the internal scoring
// sub-call in ai/generate — that per-route optimization is gone now that
// the platform path, like BYOK, resolves to a single configured model.
// PLATFORM_AI_MODEL can still be set to a fast/cheap model if that's the
// priority; it's just no longer hardcoded per call site.
export async function getAIClientForWorkspace(
  workspaceId: string | null,
  route: string,
): Promise<ResolvedAIClient> {
  if (!workspaceId) {
    const { client, model } = getPlatformClient()
    return { client, isByok: false, model }
  }

  const admin = createSupabaseAdmin()
  const { data: ws } = await admin
    .from('workspaces')
    .select('use_own_ai_key, byok_provider, byok_api_key_encrypted, byok_base_url, byok_model')
    .eq('id', workspaceId)
    .single()

  if (!ws?.use_own_ai_key || !ws.byok_api_key_encrypted || !ws.byok_provider || !ws.byok_model) {
    logByokUsage(workspaceId, false, route, ws?.use_own_ai_key ? 'no_key' : null, null)
    const { client, model } = getPlatformClient()
    return { client, isByok: false, model }
  }

  try {
    const apiKey = await decrypt(ws.byok_api_key_encrypted)
    const provider = ws.byok_provider as ByokProvider
    logByokUsage(workspaceId, true, route, null, provider)
    return {
      client: createProviderClient(provider, apiKey, ws.byok_base_url),
      isByok: true,
      model:  ws.byok_model,
    }
  } catch (err: any) {
    recordByokError(workspaceId, `decrypt_failed: ${err?.message ?? 'unknown error'}`)
    logByokUsage(workspaceId, false, route, 'decrypt_failed', ws.byok_provider)
    const { client, model } = getPlatformClient()
    return { client, isByok: false, model }
  }
}

// ── Non-blocking error recorder ──────────────────────────────────────────
// Surfaces the most recent BYOK failure on the workspace row so Settings
// can show "Your key stopped working on <date>: <reason>" without needing
// a separate table lookup. Supabase's query builder is a "thenable", not a
// real Promise, so it has no .catch() — wrap with Promise.resolve() first
// (same pattern used for generation_logs writes in ai/generate/route.ts).
export function recordByokError(workspaceId: string, error: string): void {
  const admin = createSupabaseAdmin()
  Promise.resolve(
    admin.from('workspaces').update({
      byok_key_last_error:    error.slice(0, 500),
      byok_key_last_error_at: new Date().toISOString(),
    }).eq('id', workspaceId),
  ).catch(() => {})
}

// ── Non-blocking usage log ───────────────────────────────────────────────
function logByokUsage(
  workspaceId: string,
  usedByok: boolean,
  route: string,
  fallbackReason: string | null,
  provider: string | null,
): void {
  const admin = createSupabaseAdmin()
  Promise.resolve(
    admin.from('byok_usage_log').insert({
      workspace_id:    workspaceId,
      used_byok:       usedByok,
      fallback_reason: fallbackReason,
      route,
      provider,
    }),
  ).catch(() => {})
}

// ── Encrypt + persist a new key (used by the management API route) ──────
export async function saveByokKey(
  workspaceId: string,
  provider: ByokProvider,
  apiKey: string,
  baseUrl: string | null,
  model: string,
): Promise<void> {
  const admin = createSupabaseAdmin()
  const encrypted = await encrypt(apiKey)
  const { error } = await admin.from('workspaces').update({
    byok_api_key_encrypted:     encrypted,
    byok_provider:              provider,
    byok_base_url:              provider === 'openai_compatible' ? baseUrl : null,
    byok_model:                 model,
    use_own_ai_key:             true,
    byok_key_added_at:          new Date().toISOString(),
    byok_key_last_validated_at: new Date().toISOString(),
    byok_key_last_error:        null,
    byok_key_last_error_at:     null,
  }).eq('id', workspaceId)
  if (error) throw new Error(`Failed to save key: ${error.message}`)
}

export async function removeByokKey(workspaceId: string): Promise<void> {
  const admin = createSupabaseAdmin()
  const { error } = await admin.from('workspaces').update({
    byok_api_key_encrypted: null,
    byok_provider:          null,
    byok_base_url:          null,
    byok_model:             null,
    use_own_ai_key:         false,
    byok_key_added_at:      null,
  }).eq('id', workspaceId)
  if (error) throw new Error(`Failed to remove key: ${error.message}`)
}
