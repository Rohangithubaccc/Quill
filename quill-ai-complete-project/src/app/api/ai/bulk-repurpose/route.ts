import { NextRequest }  from 'next/server'
import { z }            from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { getCreditCost, getUpgradeMessage, OPERATION_CREDITS } from '@/lib/credits'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/bulk-repurpose
//
// Validates the request, checks credits, then sends the
// quill/content.repurpose.bulk Inngest event which triggers the
// bulkRepurpose function in src/inngest/functions.ts.
//
// The Inngest function:
//   - Generates each repurpose type sequentially (avoids parallel rate limits against whichever provider is resolved)
//   - Saves each as a new content_pieces row (parent_id = source)
//   - Updates a job_results row on completion
//
// Client flow:
//   1. POST /api/ai/bulk-repurpose → { jobId }
//   2. Poll GET /api/jobs/{jobId} every 4s → { status, result: { pieces } }
//   3. Show banner linking to /dashboard when complete
//
// Credit cost: 5 credits × number of repurpose types selected
// Max types: 5 (one per valid type) = max 25 credits per call
// ─────────────────────────────────────────────────────────────────────────────

const VALID_REPURPOSE_TYPES = [
  'linkedin_post',
  'twitter_thread',
  'email_newsletter',
  'instagram_caption',
  'executive_summary',
] as const

type RepurposeType = typeof VALID_REPURPOSE_TYPES[number]

// CREDITS_PER_TYPE used to be a hardcoded local constant with a comment
// claiming it matched OPERATION_CREDITS.repurpose — found during a
// ruthless pass that nothing actually enforced that beyond the comment
// itself. This file's own header above says "NEVER hardcode credit
// values in route files" for exactly this reason: the refund logic in
// functions.ts already imports OPERATION_CREDITS.repurpose directly, so
// a future pricing change here without updating that comment would have
// silently made the upfront charge and the on-failure refund diverge.
const CREDITS_PER_TYPE = OPERATION_CREDITS.repurpose

const BulkRepurposeSchema = z.object({
  contentId:       z.string().uuid('contentId must be a valid UUID'),
  repurposeTypes:  z.array(
    z.enum(VALID_REPURPOSE_TYPES as unknown as [string, ...string[]])
  )
    .min(1, 'Select at least one repurpose type')
    .max(5, 'Maximum 5 types per bulk repurpose')
    // The frontend's checkbox UI can never produce duplicates (toggling
    // the same type twice removes it), so this is only reachable by
    // calling the API directly — but without this check, a hand-crafted
    // duplicate array would silently pass credit deduction (which just
    // multiplies array length × cost) and queue the same repurpose type
    // multiple times for no product value. Found during a ruthless
    // adversarial pass.
    .refine(types => new Set(types).size === types.length, 'Repurpose types must be unique'),
})

export async function POST(req: NextRequest) {

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let ws: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try { ({ workspace: ws } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  // ── 2. Validate body ───────────────────────────────────────────────────────
  let body: z.infer<typeof BulkRepurposeSchema>
  try { body = BulkRepurposeSchema.parse(await req.json()) }
  catch (e) {
    return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid request body')
  }

  const { contentId, repurposeTypes } = body
  const totalCreditCost = repurposeTypes.length * CREDITS_PER_TYPE
  const wsAny           = ws as any

  // ── 3. Credit check ────────────────────────────────────────────────────────
  if (wsAny.credits_remaining < totalCreditCost) {
    return new Response(
      JSON.stringify({
        error:             'insufficient_credits',
        credits_remaining: wsAny.credits_remaining,
        credits_cost:      totalCreditCost,
        plan:              ws.plan,
        message:           getUpgradeMessage(wsAny.credits_remaining, totalCreditCost, ws.plan),
        detail:            `${repurposeTypes.length} types × ${CREDITS_PER_TYPE} credits = ${totalCreditCost} credits needed`,
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const admin = createSupabaseAdmin()

  // ── 4. Verify source content exists and belongs to this workspace ──────────
  const { data: sourceContent, error: srcErr } = await admin
    .from('content_pieces')
    .select('id, title, content_type, workspace_id')
    .eq('id', contentId)
    .eq('workspace_id', ws.id)
    .single()

  if (srcErr || !sourceContent) {
    return jsonError('Source content not found or access denied', 404)
  }

  // ── 5. Dedup check: prevent re-queuing if a job is already running ─────────
  const { data: existingJob } = await admin
    .from('job_results')
    .select('id, status')
    .eq('workspace_id', ws.id)
    .eq('job_type', 'bulk_repurpose')
    .in('status', ['pending', 'running'])
    .eq('payload->>contentId', contentId)
    .limit(1)
    .single()

  if (existingJob) {
    // Return the existing job ID so client can poll it
    return jsonOk({
      jobId:         existingJob.id,
      alreadyQueued: true,
      message:       'A bulk repurpose job for this content is already running.',
    })
  }

  // ── 6. Deduct credits upfront ──────────────────────────────────────────────
  // Deducted before queuing — the Inngest function itself never deducts.
  // It DOES refund, though: any type that fails (the AI call or the DB
  // insert) gets its CREDITS_PER_TYPE refunded in a 'refund-failed-types'
  // step after the batch finishes, so paying for 5 and getting 3 means a
  // refund for the 2 that didn't land, not a silent loss. See
  // bulkRepurpose in src/inngest/functions.ts.
  // Atomic — see migration 026_atomic_credits.sql.
  const { data: creditResult, error: creditErr } = await admin.rpc('deduct_credits', {
    p_workspace_id: ws.id,
    p_amount:       totalCreditCost,
  })
  const creditRow = creditResult?.[0]

  if (creditErr || !creditRow?.success) {
    return jsonError('Insufficient credits — your balance may have just changed. Please refresh and try again.', 402)
  }
  const newBalance = creditRow.new_balance

  // ── 7. Send Inngest event ──────────────────────────────────────────────────
  // The bulkRepurpose function in src/inngest/functions.ts handles the rest.
  // Payload must match exactly: { contentId, workspaceId, userId, repurposeTypes }
  const { inngest } = await import('@/inngest/client')

  await inngest.send({
    name: 'quill/content.repurpose.bulk',
    data: {
      contentId,
      workspaceId:    ws.id,
      userId:         user.id,
      repurposeTypes: repurposeTypes as RepurposeType[],
    },
  })

  // ── 8. Create a pending job_results row for immediate polling ─────────────
  // The Inngest function creates its own job row in step 'create-job',
  // but there's a race window (~1s) between now and when Inngest starts.
  // Creating a pending row here lets the client start polling immediately.
  const { data: jobRow } = await admin
    .from('job_results')
    .insert({
      job_type:     'bulk_repurpose',
      workspace_id: ws.id,
      payload:      { contentId, repurposeTypes, totalCreditCost },
      status:       'pending',
      result:       null,
    })
    .select('id')
    .single()

  const jobId = jobRow?.id ?? null

  return jsonOk({
    jobId,
    repurposeTypes,
    totalCreditCost,
    creditsRemaining: newBalance,
    message: `Queued ${repurposeTypes.length} repurpose variant${repurposeTypes.length !== 1 ? 's' : ''}. Poll /api/jobs/${jobId} for progress.`,
  }, 202)
}
