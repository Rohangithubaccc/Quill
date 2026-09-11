import { NextRequest } from 'next/server'
import { z }           from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { validateProviderKey } from '@/lib/ai-providers'
import { saveByokKey, removeByokKey } from '@/lib/ai-byok'
import { getLimiter, checkLimit, rateLimitResponse } from '@/lib/rate-limit'

// Provider-specific shapes via a discriminated union — 'anthropic' needs no
// base URL (fixed endpoint); 'openai_compatible' requires one, since that's
// what lets it target any provider (OpenAI, Google Gemini, NVIDIA NIM,
// Groq, Together, self-hosted, etc.) rather than one hardcoded brand.
// No fixed key-format check for openai_compatible — see the comment in
// src/lib/ai-providers/validate.ts for why: there's no single prefix
// shared across that many providers, and enforcing one would recreate the
// exact "we only really support one kind of key" problem this exists to
// remove. validateProviderKey() below does the real check either way, with
// a live minimal request against the actual endpoint.
const SaveKeySchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('anthropic'),
    apiKey:   z.string().min(20, 'That doesn\'t look like a valid Anthropic API key.'),
    model:    z.string().min(1, 'Choose a Claude model.'),
  }),
  z.object({
    provider: z.literal('openai_compatible'),
    apiKey:   z.string().min(8, 'That doesn\'t look like a valid API key.'),
    baseUrl:  z.string().url('Enter a valid base URL, e.g. https://api.openai.com/v1'),
    model:    z.string().min(1, 'Enter the model name to use with this endpoint.'),
  }),
])

// GET /api/workspace/byok — status only, never the key itself.
// Any active workspace member can view status; only owners can change it.
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data: ws } = await admin
    .from('workspaces')
    .select(`
      use_own_ai_key,
      byok_api_key_encrypted,
      byok_provider,
      byok_base_url,
      byok_model,
      byok_key_added_at,
      byok_key_last_validated_at,
      byok_key_last_error,
      byok_key_last_error_at
    `)
    .eq('id', workspace.id)
    .single()

  return jsonOk({
    configured:      !!ws?.byok_api_key_encrypted,
    useOwnKey:        ws?.use_own_ai_key ?? false,
    provider:         ws?.byok_provider ?? null,
    baseUrl:          ws?.byok_base_url ?? null,
    model:            ws?.byok_model ?? null,
    addedAt:          ws?.byok_key_added_at ?? null,
    lastValidatedAt:  ws?.byok_key_last_validated_at ?? null,
    lastError:        ws?.byok_key_last_error ?? null,
    lastErrorAt:      ws?.byok_key_last_error_at ?? null,
  })
}

// POST /api/workspace/byok — validate + save a new key, and turn BYOK on.
// Owner-only, matching the domains/custom-domain enforcement pattern.
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (role !== 'owner') return jsonError('Only workspace owners can configure a BYOK API key', 403)

  // Every validation attempt makes a real outbound HTTP request to
  // whatever endpoint the workspace configured (SSRF-guarded via
  // safeFetch in the openai_compatible provider, but still real network
  // activity against a third party) — this route had no throttling at
  // all before this pass, unlike every other route that triggers an
  // outbound request on the caller's behalf.
  const limiter = getLimiter('rl:byok-save', 10, '1 h')
  const { success, reset } = await checkLimit(limiter, user.id)
  if (!success) return rateLimitResponse('Too many key-validation attempts. Try again later.', reset)

  let body: z.infer<typeof SaveKeySchema>
  try { body = SaveKeySchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const baseUrl = body.provider === 'openai_compatible' ? body.baseUrl : null
  const result  = await validateProviderKey(body.provider, body.apiKey, baseUrl, body.model)
  if (!result.valid) return jsonError(result.error ?? 'This key could not be validated.', 422)

  try {
    await saveByokKey(workspace.id, body.provider, body.apiKey, baseUrl, body.model)
  } catch (e: any) {
    return jsonError(e?.message ?? 'Failed to save key', 500)
  }

  return jsonOk({ saved: true, useOwnKey: true })
}

// DELETE /api/workspace/byok — remove the key and revert to the platform key.
export async function DELETE(_req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (role !== 'owner') return jsonError('Only workspace owners can remove the BYOK API key', 403)

  try {
    await removeByokKey(workspace.id)
  } catch (e: any) {
    return jsonError(e?.message ?? 'Failed to remove key', 500)
  }

  return jsonOk({ deleted: true })
}
