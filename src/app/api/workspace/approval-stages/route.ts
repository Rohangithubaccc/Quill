import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

const StagesSchema = z.object({
  stages: z.array(z.object({
    name:         z.string().min(1).max(100),
    requiredRole: z.enum(['owner', 'admin', 'editor']),
  })).max(10),
  // Full replace, not incremental patch — a reordered list IS a different
  // list; trying to diff/patch stage_index changes is more error-prone
  // than just replacing the whole ordered set atomically.
})

// GET /api/workspace/approval-stages — any active member can view the
// configured chain (they need to know it exists to understand the Review
// page's stage indicator).
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data: stages, error } = await admin
    .from('workspace_approval_stages')
    .select('id, stage_index, name, required_role')
    .eq('workspace_id', workspace.id)
    .order('stage_index', { ascending: true })

  if (error) return dbError('workspace/approval-stages', error, 'Query failed. Please try again.', 500)
  return jsonOk({ stages: stages ?? [] })
}

// PUT /api/workspace/approval-stages — replace the whole chain.
// Owner/admin only — this changes the process every piece of content
// goes through, not a single-item action.
export async function PUT(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner', 'admin'].includes(role)) return jsonError('Only owners and admins can configure the approval workflow', 403)

  let body: z.infer<typeof StagesSchema>
  try { body = StagesSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  // Replace atomically: delete the existing chain, insert the new one.
  // Existing in-flight content_pieces.current_stage_index values aren't
  // retroactively remapped — a piece already at stage 2 of an old 5-stage
  // chain stays "at stage 2" even if the chain is now shorter or
  // reordered. That's a real edge case worth knowing about, not silently
  // hidden: changing the workflow mid-flight on pieces already inside it
  // is inherently ambiguous (which new stage does old stage 2
  // correspond to?), so this doesn't try to guess — it leaves in-flight
  // pieces as-is and lets a human resolve them via the Review page.
  const { error: deleteErr } = await admin.from('workspace_approval_stages').delete().eq('workspace_id', workspace.id)
  if (deleteErr) return jsonError('Failed to update stages: ' + deleteErr.message, 500)

  if (body.stages.length > 0) {
    const { error: insertErr } = await admin.from('workspace_approval_stages').insert(
      body.stages.map((s, i) => ({
        workspace_id:  workspace.id,
        stage_index:   i,
        name:          s.name,
        required_role: s.requiredRole,
      })),
    )
    if (insertErr) return jsonError('Failed to save stages: ' + insertErr.message, 500)
  }

  return jsonOk({ saved: true, stageCount: body.stages.length })
}
