import { NextRequest } from 'next/server'
import { z }           from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { validateAnthropicKey, saveAnthropicKey, removeAnthropicKey } from '@/lib/anthropic-byok'

const SaveKeySchema = z.object({
  // The min(20) length check alone accepted any 20+ character string —
  // found during a ruthless pass that a typo'd or wrong-service key
  // wouldn't be caught until the real validateAnthropicKey() API call
  // below fails, several seconds later with a less specific error.
  // Anthropic API keys are consistently 'sk-ant-'-prefixed; checking
  // that here fails fast with a clearer message and skips a wasted
  // outbound API call for obviously-wrong input.
  apiKey: z.string()
    .min(20, 'That doesn\'t look like a valid Anthropic API key.')
    .refine(k => k.startsWith('sk-ant-'), 'Anthropic API keys start with "sk-ant-". Double-check you copied the whole key.'),
})

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
      use_own_anthropic_key,
      anthropic_api_key_encrypted,
      anthropic_key_added_at,
      anthropic_key_last_validated_at,
      anthropic_key_last_error,
      anthropic_key_last_error_at
    `)
    .eq('id', workspace.id)
    .single()

  return jsonOk({
    configured:        !!ws?.anthropic_api_key_encrypted,
    useOwnKey:          ws?.use_own_anthropic_key ?? false,
    addedAt:            ws?.anthropic_key_added_at ?? null,
    lastValidatedAt:    ws?.anthropic_key_last_validated_at ?? null,
    lastError:          ws?.anthropic_key_last_error ?? null,
    lastErrorAt:        ws?.anthropic_key_last_error_at ?? null,
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
  if (role !== 'owner') return jsonError('Only workspace owners can configure a BYOK Anthropic key', 403)

  let body: z.infer<typeof SaveKeySchema>
  try { body = SaveKeySchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const result = await validateAnthropicKey(body.apiKey)
  if (!result.valid) return jsonError(result.error ?? 'This key could not be validated.', 422)

  try {
    await saveAnthropicKey(workspace.id, body.apiKey)
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
  if (role !== 'owner') return jsonError('Only workspace owners can remove the BYOK Anthropic key', 403)

  try {
    await removeAnthropicKey(workspace.id)
  } catch (e: any) {
    return jsonError(e?.message ?? 'Failed to remove key', 500)
  }

  return jsonOk({ deleted: true })
}
