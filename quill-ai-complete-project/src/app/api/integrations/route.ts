import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data, error } = await admin
    .from('integrations')
    .select('provider, status, connected_at, config')
    .eq('workspace_id', workspace.id)

  if (error) return jsonError('Query failed', 500)

  // Strip encrypted secrets from response
  const safe = (data ?? []).map((int) => {
    const config = { ...(int.config as Record<string, unknown>) }
    delete config.encrypted_password
    delete config.encrypted_token
    return { ...int, config }
  })

  return jsonOk({ integrations: safe })
}
