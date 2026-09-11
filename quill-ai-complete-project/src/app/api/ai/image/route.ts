import { NextRequest }  from 'next/server'
import { z }            from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { getCreditCost, getUpgradeMessage }                   from '@/lib/credits'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { getLimiter, checkLimit, getClientIp }                from '@/lib/rate-limit'

export const runtime     = 'nodejs'
export const maxDuration = 30

const RequestSchema = z.object({ contentId: z.string().uuid() })

// POST /api/ai/image
// Sends the generation request to Inngest queue and returns a jobId.
// Client polls GET /api/jobs/{jobId} for the result (status: complete|failed).
//
// Async flow:
//   1. Auth + rate limit + credit check (synchronous — fast)
//   2. Deduct credits immediately (reserve before generation)
//   3. Send quill/image.generate event to Inngest
//   4. Return { async: true, jobId } immediately — don't wait for DALL-E
//
// Client polls GET /api/jobs/{jobId} every 3 seconds until:
//   status: 'complete' → result.imageUrl is ready
//   status: 'failed'   → show error, refund credits via onFailure handler
export async function POST(req: NextRequest) {

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let ws: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try { ({ workspace: ws } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  // ── 2. Rate limiting ───────────────────────────────────────────────────────
  const ip = getClientIp(req)
  const imgIpLimiter   = getLimiter('rl:img:ip',  3, '1 m')
  const imgUserLimiter = getLimiter('rl:img:usr', 5, '1 h')
  const [ipRes, userRes] = await Promise.all([
    checkLimit(imgIpLimiter, ip),
    checkLimit(imgUserLimiter, user.id),
  ])
  if (!ipRes.success) {
    return new Response(
      JSON.stringify({ error: 'Too many image requests from this IP. Try again in a minute.' }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((ipRes.reset - Date.now()) / 1000)) } }
    )
  }
  if (!userRes.success) {
    return new Response(
      JSON.stringify({ error: `Image generation limit reached (5 per hour). Resets in ${Math.ceil((userRes.reset - Date.now()) / 60000)} minutes.` }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((userRes.reset - Date.now()) / 1000)) } }
    )
  }

  // ── 3. Validate body ───────────────────────────────────────────────────────
  let body: z.infer<typeof RequestSchema>
  try { body = RequestSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  // ── 4. Credit check ────────────────────────────────────────────────────────
  const creditCost = getCreditCost('', 'image_generation')   // always 5
  const wsAny      = ws as any

  if (wsAny.credits_remaining < creditCost) {
    return new Response(
      JSON.stringify({
        error:             'insufficient_credits',
        credits_remaining: wsAny.credits_remaining,
        credits_cost:      creditCost,
        plan:              ws.plan,
        message:           getUpgradeMessage(wsAny.credits_remaining, creditCost, ws.plan),
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonError('Image generation not configured — add OPENAI_API_KEY to environment', 503)
  }

  const admin = createSupabaseAdmin()

  // ── 5. Verify content piece belongs to this workspace ─────────────────────
  const { data: piece, error: pieceErr } = await admin
    .from('content_pieces')
    .select('id, title, industry, content_type')
    .eq('id', body.contentId)
    .eq('workspace_id', ws.id)
    .single()

  if (pieceErr || !piece) return jsonError('Content not found or access denied', 404)

  // ── 6. Deduct credits upfront (reserve before queuing) ────────────────────
  // Credits are deducted before the Inngest job starts so the user can't
  // spam the button. If all Inngest retries fail, the onFailure handler
  // in functions.ts refunds them automatically.
  // Atomic — see migration 026_atomic_credits.sql: the previous version
  // computed `wsAny.credits_remaining - creditCost` in JS and wrote that
  // back, which loses deductions under concurrent requests to the same
  // workspace (confirmed empirically — see the setup guide's Security
  // pass section for the reproduction).
  const { data: deductResult, error: deductErr } = await admin.rpc('deduct_credits', {
    p_workspace_id: ws.id,
    p_amount:       creditCost,
  })
  const deductRow = deductResult?.[0]

  if (deductErr || !deductRow?.success) {
    return jsonError('Insufficient credits — your balance may have just changed. Please refresh and try again.', 402)
  }
  const newBalance = deductRow.new_balance

  // ── 7. Send to Inngest queue ───────────────────────────────────────────────
  // asyncImageGeneration function handles: DALL-E call, Storage upload,
  // content_pieces update, job_results completion.
  // concurrency: { limit: 5 } in the function prevents DALL-E 429s at scale.
  const { inngest } = await import('@/inngest/client')

  const sendResult = await inngest.send({
    name: 'quill/image.generate',
    data: {
      contentId:   body.contentId,
      workspaceId: ws.id,
      userId:      user.id,
      creditCost,
    },
  })

  // Extract jobId from the Inngest event ID (used to look up job_results row)
  // The Inngest function creates a job_results row and includes jobId in its return.
  // For immediate polling, we create a pending job_results row here.
  const { data: jobRow } = await admin
    .from('job_results')
    .insert({
      job_type:     'image_generation',
      workspace_id: ws.id,
      payload:      { contentId: body.contentId, inngestEventId: sendResult.ids?.[0] },
      status:       'pending',
      result:       null,
    })
    .select('id')
    .single()

  const jobId = jobRow?.id ?? null

  return jsonOk({
    async:            true,
    jobId,
    message:          'Image generation queued. Poll /api/jobs/{jobId} for the result.',
    creditCost,
    creditsRemaining: newBalance,
    estimatedSeconds: 15,
  })
}
