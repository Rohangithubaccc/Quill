import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

const CreateSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  goal:        z.string().max(100).optional(),
  startDate:   z.string().optional(),   // 'YYYY-MM-DD'
  endDate:     z.string().optional(),
}).refine(
  d => !d.startDate || !d.endDate || d.endDate >= d.startDate,
  { message: 'End date must be on or after the start date', path: ['endDate'] },
)

// ── GET /api/campaigns — list with rollup stats ──────────────────────────
// Each campaign comes back with pieceCount, a status breakdown, and an
// engagement rollup — the numbers that make "Campaign" a useful unit
// rather than just a label on content_pieces.
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  const admin = createSupabaseAdmin()

  let query = admin
    .from('campaigns')
    .select('id, name, description, goal, status, start_date, end_date, created_at, updated_at, created_by')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data: campaigns, error } = await query
  if (error) return dbError('campaigns', error, 'Query failed. Please try again.', 500)
  if (!campaigns || campaigns.length === 0) return jsonOk({ items: [] })

  // Single query for all pieces across every campaign in this workspace,
  // then aggregate in JS — avoids N+1 queries (one per campaign) and
  // avoids a fragile hand-rolled SQL aggregate against the untyped client
  // this codebase uses elsewhere (see src/lib/supabase/server.ts note).
  const campaignIds = campaigns.map(c => c.id)
  const { data: pieces } = await admin
    .from('content_pieces')
    .select('id, campaign_id, status, engagement_score, platforms')
    .in('campaign_id', campaignIds)
    .is('deleted_at', null)

  const rollups = new Map<string, {
    pieceCount: number
    statusCounts: Record<string, number>
    avgEngagement: number | null
    platforms: Set<string>
  }>()
  for (const id of campaignIds) {
    rollups.set(id, { pieceCount: 0, statusCounts: {}, avgEngagement: null, platforms: new Set() })
  }

  const engagementSums = new Map<string, { sum: number; count: number }>()
  for (const p of pieces ?? []) {
    const r = rollups.get(p.campaign_id as string)
    if (!r) continue
    r.pieceCount += 1
    r.statusCounts[p.status] = (r.statusCounts[p.status] ?? 0) + 1
    for (const plat of p.platforms ?? []) r.platforms.add(plat)
    if (p.engagement_score != null) {
      const e = engagementSums.get(p.campaign_id as string) ?? { sum: 0, count: 0 }
      e.sum += Number(p.engagement_score)
      e.count += 1
      engagementSums.set(p.campaign_id as string, e)
    }
  }
  for (const [id, e] of engagementSums) {
    const r = rollups.get(id)
    if (r) r.avgEngagement = Math.round((e.sum / e.count) * 100) / 100
  }

  const items = campaigns.map(c => {
    const r = rollups.get(c.id)!
    return {
      ...c,
      pieceCount:    r.pieceCount,
      statusCounts:  r.statusCounts,
      avgEngagement: r.avgEngagement,
      platforms:     Array.from(r.platforms),
    }
  })

  return jsonOk({ items })
}

// ── POST /api/campaigns — create ─────────────────────────────────────────
// Any active member can create a campaign (matches content_pieces INSERT
// policy — creation isn't owner-gated, only deletion is).
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  let body: z.infer<typeof CreateSchema>
  try { body = CreateSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()
  const { data: campaign, error } = await admin
    .from('campaigns')
    .insert({
      workspace_id: workspace.id,
      created_by:   user.id,
      name:         body.name,
      description:  body.description ?? null,
      goal:         body.goal ?? null,
      start_date:   body.startDate ?? null,
      end_date:     body.endDate ?? null,
    })
    .select()
    .single()

  if (error) return dbError('campaigns', error, 'Failed to create campaign. Please try again.', 500)
  return jsonOk({ campaign }, 201)
}
