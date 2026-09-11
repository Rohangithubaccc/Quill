import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

function getContentIdFromUrl(req: NextRequest): string {
  // path is /api/content/:id/approval/history
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 3]
}

// GET /api/content/:id/approval/history — the audit trail for one piece.
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const contentId = getContentIdFromUrl(req)
  const admin = createSupabaseAdmin()

  const { data: piece } = await admin.from('content_pieces').select('id').eq('id', contentId).eq('workspace_id', workspace.id).single()
  if (!piece) return jsonError('Content not found', 404)

  const { data: history, error } = await admin
    .from('approval_history')
    .select('id, stage_index, stage_name, action, actor_user_id, note, created_at')
    .eq('content_id', contentId)
    .order('created_at', { ascending: true })

  if (error) return dbError('content/:id/approval/history', error, 'Query failed. Please try again.', 500)

  // Resolve actor emails for display — auth.users isn't directly
  // queryable via the regular client, so this uses the admin auth API,
  // same pattern as the approval-email lookup in /api/content/route.ts.
  const actorIds = Array.from(new Set((history ?? []).map(h => h.actor_user_id).filter(Boolean)))
  const actorEmails = new Map<string, string>()
  await Promise.all(actorIds.map(async id => {
    const { data } = await admin.auth.admin.getUserById(id as string)
    if (data?.user?.email) actorEmails.set(id as string, data.user.email)
  }))

  return jsonOk({
    items: (history ?? []).map(h => ({
      ...h,
      actorEmail: h.actor_user_id ? actorEmails.get(h.actor_user_id) ?? null : null,
    })),
  })
}
