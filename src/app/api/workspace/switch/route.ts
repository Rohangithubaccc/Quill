import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseAdmin, requireUser } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  const { workspaceId } = await req.json() as { workspaceId: string }
  if (!workspaceId) return jsonError('workspaceId required')

  const admin = createSupabaseAdmin()

  // Verify user is an active member of the target workspace
  // Cast to any: this loose Database stub can't resolve Supabase's
  // nested-join type inference for aliased relations like
  // `workspace:workspaces(...)`. Real generated types would resolve
  // this correctly — see src/lib/types/database.ts for details.
  const { data: member, error } = await (admin
    .from('workspace_members')
    .select('workspace_id, role, workspace:workspaces(id, name, plan, usage_count, usage_limit)')
    .eq('user_id', user.id)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .single() as any)

  if (error || !member) {
    return jsonError('You are not a member of this workspace', 403)
  }

  // Update the workspace_id cookie
  const cookieStore = await cookies()
  cookieStore.set('workspace_id', workspaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })

  return jsonOk({ workspace: member.workspace, role: member.role })
}
