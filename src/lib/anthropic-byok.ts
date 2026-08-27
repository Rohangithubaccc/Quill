// ── Hybrid BYOK (Bring Your Own Key) resolver for Anthropic ────────────────
//
// Every AI route that calls Anthropic should get its client from
// getAnthropicClientForWorkspace() instead of instantiating `new Anthropic()`
// directly. This keeps the "which key do we use?" decision in one place:
//
//   - Workspace has use_own_anthropic_key = true AND a stored, decryptable
//     key  → use the workspace's own Anthropic account. Quill.AI pays
//     nothing for these tokens.
//   - Otherwise (no key, opted out, or the key fails to decrypt/validate)
//     → fall back to the platform key. The request still succeeds; we just
//     log why BYOK wasn't used so the workspace owner can see it in
//     Settings → API Keys.
//
// The platform Anthropic client is a lazy singleton for the same reason the
// Resend/Stripe clients are lazy elsewhere in this codebase: importing this
// module (e.g. during `next build`'s page-data collection) must never throw
// just because ANTHROPIC_API_KEY isn't set at that moment.

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/utils'

let _platformClient: Anthropic | null = null
function getPlatformClient(): Anthropic {
  if (!_platformClient) {
    _platformClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return _platformClient
}

export interface ResolvedAnthropicClient {
  client:  Anthropic
  isByok:  boolean
}

// ── Resolve the right client for a generation call ──────────────────────────
// workspaceId may be null for routes with no workspace context (e.g. the
// public /try demo) — those always run on the platform key.
export async function getAnthropicClientForWorkspace(
  workspaceId: string | null,
  route: string,
): Promise<ResolvedAnthropicClient> {
  if (!workspaceId) {
    return { client: getPlatformClient(), isByok: false }
  }

  const admin = createSupabaseAdmin()
  const { data: ws } = await admin
    .from('workspaces')
    .select('use_own_anthropic_key, anthropic_api_key_encrypted')
    .eq('id', workspaceId)
    .single()

  if (!ws?.use_own_anthropic_key || !ws.anthropic_api_key_encrypted) {
    logByokUsage(workspaceId, false, route, ws?.use_own_anthropic_key ? 'no_key' : null)
    return { client: getPlatformClient(), isByok: false }
  }

  try {
    const apiKey = await decrypt(ws.anthropic_api_key_encrypted)
    logByokUsage(workspaceId, true, route, null)
    return { client: new Anthropic({ apiKey }), isByok: true }
  } catch (err: any) {
    recordByokError(workspaceId, `decrypt_failed: ${err?.message ?? 'unknown error'}`)
    logByokUsage(workspaceId, false, route, 'decrypt_failed')
    return { client: getPlatformClient(), isByok: false }
  }
}

// ── Validate a key before saving it ──────────────────────────────────────
// A minimal, cheap call (1 output token, Haiku) so we know the key actually
// authenticates against Anthropic before we encrypt and store it.
export async function validateAnthropicKey(
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return { valid: false, error: 'Anthropic API keys start with "sk-ant-".' }
  }

  try {
    const client = new Anthropic({ apiKey })
    await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages:   [{ role: 'user', content: 'hi' }],
    })
    return { valid: true }
  } catch (err: any) {
    const status = err?.status
    if (status === 401) return { valid: false, error: 'Invalid API key — Anthropic rejected it.' }
    if (status === 403) return { valid: false, error: 'This key does not have permission to use the Messages API.' }
    if (status === 429) {
      // Rate-limited, not invalid — the key itself authenticated fine.
      return { valid: true }
    }
    return { valid: false, error: err?.message ?? 'Could not validate this key — please try again.' }
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
      anthropic_key_last_error:    error.slice(0, 500),
      anthropic_key_last_error_at: new Date().toISOString(),
    }).eq('id', workspaceId),
  ).catch(() => {})
}

// ── Non-blocking usage log ───────────────────────────────────────────────
function logByokUsage(
  workspaceId: string,
  usedByok: boolean,
  route: string,
  fallbackReason: string | null,
): void {
  const admin = createSupabaseAdmin()
  Promise.resolve(
    admin.from('byok_usage_log').insert({
      workspace_id:    workspaceId,
      used_byok:       usedByok,
      fallback_reason: fallbackReason,
      route,
    }),
  ).catch(() => {})
}

// ── Encrypt + persist a new key (used by the management API route) ──────
export async function saveAnthropicKey(workspaceId: string, apiKey: string): Promise<void> {
  const admin = createSupabaseAdmin()
  const encrypted = await encrypt(apiKey)
  const { error } = await admin.from('workspaces').update({
    anthropic_api_key_encrypted:     encrypted,
    use_own_anthropic_key:           true,
    anthropic_key_added_at:          new Date().toISOString(),
    anthropic_key_last_validated_at: new Date().toISOString(),
    anthropic_key_last_error:        null,
    anthropic_key_last_error_at:     null,
  }).eq('id', workspaceId)
  if (error) throw new Error(`Failed to save key: ${error.message}`)
}

export async function removeAnthropicKey(workspaceId: string): Promise<void> {
  const admin = createSupabaseAdmin()
  const { error } = await admin.from('workspaces').update({
    anthropic_api_key_encrypted: null,
    use_own_anthropic_key:       false,
    anthropic_key_added_at:      null,
  }).eq('id', workspaceId)
  if (error) throw new Error(`Failed to remove key: ${error.message}`)
}
