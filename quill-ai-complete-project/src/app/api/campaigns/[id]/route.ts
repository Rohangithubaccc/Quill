import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

const PatchSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  goal:        z.string().max(100).nullable().optional(),
  status:      z.enum(['draft', 'active', 'completed', 'archived']).optional(),
  startDate:   z.string().nullable().optional(),
  endDate:     z.string().nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' })

function getIdFromUrl(req: NextRequest): string {
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 1]
}

// ── GET /api/campaigns/:id — detail, with its content pieces + calendar events
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const id = getIdFromUrl(req)
  const admin = createSupabaseAdmin()

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, name, description, goal, status, start_date, end_date, created_at, updated_at, created_by')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single()

  if (error || !campaign) return jsonError('Campaign not found', 404)

  const { data: pieces } = await admin
    .from('content_pieces')
    .select('id, title, content_type, platforms, status, engagement_score, word_count, published_url, created_at')
    .eq('campaign_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const pieceIds = (pieces ?? []).map(p => p.id)
  const { data: events } = pieceIds.length > 0
    ? await admin
        .from('calendar_events')
        .select('id, title, platform, scheduled_at, status, content_id')
        .in('content_id', pieceIds)
    : { data: [] as any[] }

  const statusCounts: Record<string, number> = {}
  let engagementSum = 0, engagementCount = 0
  const platforms = new Set<string>()
  for (const p of pieces ?? []) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1
    for (const plat of p.platforms ?? []) platforms.add(plat)
    if (p.engagement_score != null) { engagementSum += Number(p.engagement_score); engagementCount += 1 }
  }

  return jsonOk({
    campaign,
    pieces: pieces ?? [],
    events: events ?? [],
    rollup: {
      pieceCount:    (pieces ?? []).length,
      statusCounts,
      avgEngagement: engagementCount > 0 ? Math.round((engagementSum / engagementCount) * 100) / 100 : null,
      platforms:     Array.from(platforms),
    },
  })
}

// ── PATCH /api/campaigns/:id — update name/description/goal/status/dates
export async function PATCH(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const id = getIdFromUrl(req)

  let body: z.infer<typeof PatchSchema>
  try { body = PatchSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()
  const { data: existing } = await admin.from('campaigns').select('id, start_date, end_date').eq('id', id).eq('workspace_id', workspace.id).single()
  if (!existing) return jsonError('Campaign not found', 404)

  // Found during the feature-logic review, same gap as POST /api/campaigns:
  // nothing prevented an end date before the start date. Trickier here
  // than at creation — a PATCH can touch just one of the two fields, so
  // the check needs the EFFECTIVE resulting pair (patch value if
  // provided, otherwise whatever's already stored), not just the two
  // fields in isolation.
  const effectiveStart = body.startDate !== undefined ? body.startDate : existing.start_date
  const effectiveEnd   = body.endDate   !== undefined ? body.endDate   : existing.end_date
  if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
    return jsonError('End date must be on or after the start date')
  }

  const updatePayload: Record<string, unknown> = {}
  if (body.name        !== undefined) updatePayload.name        = body.name
  if (body.description !== undefined) updatePayload.description = body.description
  if (body.goal        !== undefined) updatePayload.goal        = body.goal
  if (body.status      !== undefined) updatePayload.status      = body.status
  if (body.startDate    !== undefined) updatePayload.start_date  = body.startDate
  if (body.endDate      !== undefined) updatePayload.end_date    = body.endDate

  const { data: campaign, error } = await admin
    .from('campaigns')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) return dbError('campaigns/:id', error, 'Update failed. Please try again.', 500)
  return jsonOk({ campaign })
}

// ── DELETE /api/campaigns/:id — owner/admin only (also enforced by RLS)
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner', 'admin'].includes(role)) return jsonError('Only owners and admins can delete campaigns', 403)

  const id = getIdFromUrl(req)
  const admin = createSupabaseAdmin()

  const { data: existing } = await admin.from('campaigns').select('id').eq('id', id).eq('workspace_id', workspace.id).single()
  if (!existing) return jsonError('Campaign not found', 404)

  // Content pieces are NOT deleted — campaign_id just reverts to NULL via
  // the ON DELETE SET NULL foreign key (migration 019).
  const { error } = await admin.from('campaigns').delete().eq('id', id)
  if (error) return dbError('campaigns/:id', error, 'Delete failed. Please try again.', 500)

  return jsonOk({ deleted: true })
}
