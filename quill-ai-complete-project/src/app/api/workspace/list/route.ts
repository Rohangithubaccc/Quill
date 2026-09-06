import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'

export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  const admin = createSupabaseAdmin()

  const { data, error } = await admin
    .from('workspace_members')
    .select(`
      role,
      workspace:workspaces (
        id, name, slug, plan, usage_count, usage_limit, logo_url
      )
    `)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) return jsonError('Failed to fetch workspaces', 500)

  const workspaces = (data ?? []).map(m => ({
    ...(m.workspace as any),
    role: m.role,
  }))

  return jsonOk({ workspaces })
}
