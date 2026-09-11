import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { dispatchWebhook } from '@/lib/webhooks'

const ROLE_LEVEL: Record<string, number> = { owner: 3, admin: 2, editor: 1, viewer: 0 }

const BodySchema = z.object({
  note: z.string().max(1000).optional(),
})

function getContentIdFromUrl(req: NextRequest): string {
  // path is /api/content/:id/approval/advance
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 3]
}

// POST /api/content/:id/approval/advance — approve the piece at its
// current stage. If more stages remain, moves to the next one. If this
// was the last configured stage, finalizes the piece to 'approved'.
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const contentId = getContentIdFromUrl(req)

  let body: z.infer<typeof BodySchema>
  try { body = BodySchema.parse(await req.json().catch(() => ({}))) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  const { data: piece } = await admin
    .from('content_pieces')
    .select('id, workspace_id, current_stage_index, title')
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

  if (!stages || stages.length === 0) {
    return jsonError('No approval chain is configured for this workspace', 400)
  }

  const currentStage = stages.find(s => s.stage_index === piece.current_stage_index)
  if (!currentStage) {
    return jsonError('This piece\'s current stage no longer exists in the configured chain — an owner or admin should review it directly.', 409)
  }

  // Owner can always approve at any stage; otherwise the actor's role
  // must meet or exceed the stage's required_role.
  const actorLevel = ROLE_LEVEL[role] ?? 0
  const requiredLevel = ROLE_LEVEL[currentStage.required_role] ?? 99
  if (role !== 'owner' && actorLevel < requiredLevel) {
    return jsonError(`This stage ("${currentStage.name}") requires the ${currentStage.required_role} role or higher.`, 403)
  }

  const isLastStage = currentStage.stage_index === stages[stages.length - 1].stage_index
  const nextStageIndex = isLastStage ? null : currentStage.stage_index + 1

  // .eq('current_stage_index', ...) makes this an optimistic-concurrency
  // guard: if someone else already advanced this piece between this
  // route's read above and this write (e.g. two eligible approvers both
  // click Approve within the same stage at nearly the same moment), that
  // second request's WHERE clause won't match anything — .select() lets
  // us detect that (no row returned) rather than silently succeeding
  // and writing a second, redundant approval_history entry for a stage
  // that's already been advanced past.
  const { data: updated, error: updateErr } = await admin
    .from('content_pieces')
    .update({
      current_stage_index: nextStageIndex,
      status: isLastStage ? 'approved' : 'review',
    })
    .eq('id', contentId)
    .eq('current_stage_index', currentStage.stage_index)
    .select('id')
    .maybeSingle()

  if (updateErr) return jsonError('Update failed: ' + updateErr.message, 500)
  if (!updated) {
    return jsonError('This piece was already advanced by someone else — refresh to see its current stage.', 409)
  }

  await admin.from('approval_history').insert({
    content_id:    contentId,
    workspace_id:  workspace.id,
    stage_index:   currentStage.stage_index,
    stage_name:    currentStage.name,
    action:        'approved',
    actor_user_id: user.id,
    note:          body.note ?? null,
  })

  if (isLastStage) {
    dispatchWebhook(workspace.id, 'content.approved', { content_id: contentId, approved_by: user.id })
  } else {
    dispatchWebhook(workspace.id, 'content.stage_advanced', {
      content_id: contentId, approved_by: user.id,
      completed_stage: currentStage.name,
      next_stage: stages.find(s => s.stage_index === nextStageIndex)?.name ?? null,
    })
  }

  return jsonOk({
    advanced:      true,
    finalized:     isLastStage,
    nextStageIndex,
    nextStageName: isLastStage ? null : stages.find(s => s.stage_index === nextStageIndex)?.name ?? null,
  })
}
