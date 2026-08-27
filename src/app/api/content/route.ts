import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError, countWords } from '@/lib/utils'
import { dispatchWebhook }   from '@/lib/webhooks'
import { Resend }            from 'resend'
import { ContentApprovedEmail } from '@/emails/ContentApprovedEmail'
import React                 from 'react'

// Lazily instantiated so importing this module never crashes when
// RESEND_API_KEY isn't set yet — only sending an email requires the key.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!)
  return _resend
}

// ── GET /api/content — list + full-text search ──────────────────────────────
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { searchParams } = new URL(req.url)
  const status     = searchParams.get('status')
  const platform   = searchParams.get('platform')
  const campaignId = searchParams.get('campaign_id')
  const q          = searchParams.get('q')?.trim()
  // Both parseInt() results were used unvalidated — found during a
  // ruthless adversarial pass that limit=abc, limit=0, limit=-5,
  // offset=-10, and offset=abc all produce a malformed .range() call
  // (NaN, negative, or inverted), sent straight through to PostgREST
  // with no rejection at this layer. Clamping both to sane bounds here
  // means a bad value degrades to a safe default instead of reaching
  // the database as garbage.
  const rawLimit  = parseInt(searchParams.get('limit') ?? '20', 10)
  const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10)
  const limit  = Number.isFinite(rawLimit)  ? Math.min(Math.max(rawLimit, 1), 100) : 20
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0)              : 0

  const admin = createSupabaseAdmin()

  let query = admin
    .from('content_pieces')
    .select(
      'id, title, content, content_type, platforms, status, industry, tone, keyword, target_audience, word_count, engagement_score, parent_id, repurpose_type, published_url, campaign_id, current_stage_index, created_at, updated_at, created_by',
      { count: 'exact' }
    )
    .eq('workspace_id', workspace.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (campaignId) query = query.eq('campaign_id', campaignId)

  // Platform array filter
  if (platform) query = (query as any).contains('platforms', [platform])

  // Full-text search — requires the fts generated column from migration 002
  if (q && q.length >= 2) {
    query = (query as any).textSearch('fts', q, { type: 'websearch', config: 'english' })
  }

  const { data, count, error } = await query
  if (error) return dbError('content', error, 'Query failed. Please try again.', 500)

  return jsonOk({ items: data, total: count, limit, offset })
}

// ── PATCH /api/content — update status, title, content, or published_url ────
//
// Status values:
//   draft | review | needs_revision | approved | scheduled | published | rejected
//
// 'needs_revision' was added to support the 3-state review workflow
// (Approve / Needs Revision / Reject) in the review page.
const PatchSchema = z.object({
  status:        z.enum([
    'draft',
    'review',
    'needs_revision',   // ← added: reviewer clicked "Needs Revision"
    'approved',
    'scheduled',
    'published',
    'rejected',
  ]).optional(),
  title:         z.string().max(300).optional(),
  content:       z.string().optional(),
  // Found during a ruthless adversarial pass: z.string().url() validates
  // shape, not scheme — 'javascript:alert(1)' and 'data:text/html,...'
  // both pass. Traced every render site of published_url and confirmed
  // it's never output as a clickable href anywhere today, so this wasn't
  // an active exploit — but it's cheap, correct defense-in-depth to close
  // now rather than depend on that staying true forever.
  published_url: z.string().url().refine(
    u => { try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:' } catch { return false } },
    'URL must use http or https',
  ).nullable().optional(),
  campaign_id:   z.string().uuid().nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' })

export async function PATCH(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const url       = new URL(req.url)
  const segments  = url.pathname.split('/')
  const contentId = segments[segments.length - 1]
  if (!contentId || contentId === 'content') return jsonError('Content ID required in URL path')

  let body: z.infer<typeof PatchSchema>
  try { body = PatchSchema.parse(await req.json()) } catch (e) {
    return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body')
  }

  const admin = createSupabaseAdmin()
  const { data: piece } = await admin
    .from('content_pieces')
    .select('id, workspace_id, created_by, title, content_type')
    .eq('id', contentId)
    .single()

  if (!piece || piece.workspace_id !== workspace.id) return jsonError('Content not found', 404)

  if (body.campaign_id !== undefined && body.campaign_id !== null) {
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', body.campaign_id)
      .eq('workspace_id', workspace.id)
      .single()
    if (!campaign) return jsonError('Campaign not found', 404)
  }

  const updatePayload: Record<string, unknown> = {}
  if (body.status !== undefined)        updatePayload.status        = body.status
  if (body.title)                        updatePayload.title         = body.title
  if (body.published_url !== undefined)  updatePayload.published_url = body.published_url
  if (body.campaign_id !== undefined)    updatePayload.campaign_id   = body.campaign_id
  if (body.content !== undefined) {
    updatePayload.content    = body.content
    updatePayload.word_count = countWords(body.content)
  }

  // Entering review: if this workspace has a configured multi-stage
  // approval chain (migration 025), start the piece at stage 0 and log
  // it. Workspaces with no configured stages are unaffected — the plain
  // review -> approved flow keeps working exactly as before.
  let enteringConfiguredChain = false
  if (body.status === 'review') {
    const { data: stages } = await admin
      .from('workspace_approval_stages')
      .select('stage_index, name')
      .eq('workspace_id', workspace.id)
      .order('stage_index', { ascending: true })
      .limit(1)

    if (stages && stages.length > 0) {
      enteringConfiguredChain = true
      updatePayload.current_stage_index = 0
    }
  } else if (body.status !== undefined) {
    // Any other explicit status change (approved via the simple path,
    // rejected, scheduled, etc.) clears the stage pointer — it only means
    // something while status === 'review'.
    updatePayload.current_stage_index = null
  }

  const { error } = await admin.from('content_pieces').update(updatePayload).eq('id', contentId)
  if (error) return dbError('content', error, 'Update failed. Please try again.', 500)

  if (enteringConfiguredChain) {
    const { data: firstStage } = await admin
      .from('workspace_approval_stages')
      .select('stage_index, name')
      .eq('workspace_id', workspace.id)
      .eq('stage_index', 0)
      .single()

    await Promise.resolve(admin.from('approval_history').insert({
      content_id:    contentId,
      workspace_id:  workspace.id,
      stage_index:   0,
      stage_name:    firstStage?.name ?? null,
      action:        'submitted',
      actor_user_id: user.id,
    })).catch(() => {})
  }

  // Fire webhooks non-blocking — never await
  if (body.status === 'approved') {
    dispatchWebhook(workspace.id, 'content.approved', { content_id: contentId, approved_by: user.id })

    // Send approval email to the content creator (non-blocking)
    // Only send if the reviewer is NOT the creator (avoid self-notifications)
    const creatorId = (piece as any).created_by
    if (creatorId && creatorId !== user.id) {
      ;(async () => {
        try {
          const { data: creatorAuth } = await admin.auth.admin.getUserById(creatorId)
          const creatorEmail = creatorAuth?.user?.email
          if (!creatorEmail) return

          // Get reviewer name from their email (truncate before @)
          const { data: reviewerAuth } = await admin.auth.admin.getUserById(user.id)
          const reviewerEmail = reviewerAuth?.user?.email ?? ''
          const reviewerName  = reviewerEmail.split('@')[0] || 'Your reviewer'

          await getResend().emails.send({
            from:    process.env.EMAIL_FROM ?? 'noreply@quill.ai',
            to:      creatorEmail,
            subject: `Your content has been approved — "${ (piece as any).title ?? 'Untitled' }"`,
            react:   React.createElement(ContentApprovedEmail, {
              reviewerName,
              contentTitle:  (piece as any).title        ?? 'Untitled',
              contentType:   (piece as any).content_type ?? 'Content',
              reviewUrl:     `${process.env.NEXT_PUBLIC_URL ?? ''}/review`,
            }),
          })
        } catch (emailErr) {
          // Non-fatal — never let email failure affect the API response
          console.error('[content/PATCH] Approval email failed:', emailErr)
        }
      })()
    }
  }
  if (body.status === 'published' || body.published_url) {
    dispatchWebhook(workspace.id, 'content.published', { content_id: contentId, published_url: body.published_url ?? '' })
  }

  return jsonOk({ updated: true, id: contentId })
}

// ── DELETE /api/content — soft delete ────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner','admin'].includes(role)) return jsonError('Only owners and admins can delete content', 403)

  const contentId = new URL(req.url).pathname.split('/').pop()
  if (!contentId) return jsonError('Content ID required')

  const admin = createSupabaseAdmin()
  await admin
    .from('content_pieces')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', contentId)
    .eq('workspace_id', workspace.id)

  return jsonOk({ deleted: true })
}
