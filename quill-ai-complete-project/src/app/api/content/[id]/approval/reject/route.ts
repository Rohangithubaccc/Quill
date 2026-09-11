import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { dispatchWebhook } from '@/lib/webhooks'

const ROLE_LEVEL: Record<string, number> = { owner: 3, admin: 2, editor: 1, viewer: 0 }

const BodySchema = z.object({
  note: z.string().min(1, 'A note is required so the creator knows what to fix').max(1000),
})

function getContentIdFromUrl(req: NextRequest): string {
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 3]
}

// POST /api/content/:id/approval/reject — sends the piece back to the
// creator (status becomes 'needs_revision', stage pointer resets to
// null — it re-enters at stage 0 next time it's resubmitted, same as any
// first submission). A note is required — unlike advance's optional
// note, a rejection with no explanation just creates confusion about
// what needs to change.
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const contentId = getContentIdFromUrl(req)

  let body: z.infer<typeof BodySchema>
  try { body = BodySchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  const { data: piece } = await admin
    .from('content_pieces')
    .select('id, workspace_id, current_stage_index')
    .eq('id', contentId)
    .eq('workspace_id', workspace.id)
    .single()

  if (!piece) return jsonError('Content not found', 404)
  if (piece.current_stage_index === null || piece.current_stage_index === undefined) {
    return jsonError('This piece is not currently in an approval chain', 400)
  }

  const { data: stages } = await admin
    .from('workspace_approval_stages')
    .select('stage_index, name, required_role')
    .eq('workspace_id', workspace.id)
    .order('stage_index', { ascending: true })

  const currentStage = (stages ?? []).find(s => s.stage_index === piece.current_stage_index)
  if (!currentStage) {
    return jsonError('This piece\'s current stage no longer exists in the configured chain — an owner or admin should review it directly.', 409)
  }

  const actorLevel = ROLE_LEVEL[role] ?? 0
  const requiredLevel = ROLE_LEVEL[currentStage.required_role] ?? 99
  if (role !== 'owner' && actorLevel < requiredLevel) {
    return jsonError(`This stage ("${currentStage.name}") requires the ${currentStage.required_role} role or higher.`, 403)
  }

  // Same optimistic-concurrency guard as advance/route.ts — see the
  // comment there for why this matters.
  const { data: updated, error: updateErr } = await admin
    .from('content_pieces')
    .update({
      status:               'needs_revision',
      current_stage_index:  null,
    })
    .eq('id', contentId)
    .eq('current_stage_index', currentStage.stage_index)
    .select('id')
    .maybeSingle()

  if (updateErr) return jsonError('Update failed: ' + updateErr.message, 500)
  if (!updated) {
    return jsonError('This piece was already acted on by someone else — refresh to see its current state.', 409)
  }

  await admin.from('approval_history').insert({
    content_id:    contentId,
    workspace_id:  workspace.id,
    stage_index:   currentStage.stage_index,
    stage_name:    currentStage.name,
    action:        'rejected',
    actor_user_id: user.id,
    note:          body.note,
  })

  dispatchWebhook(workspace.id, 'content.rejected', { content_id: contentId, rejected_by: user.id, stage: currentStage.name, note: body.note })

  return jsonOk({ rejected: true })
}
