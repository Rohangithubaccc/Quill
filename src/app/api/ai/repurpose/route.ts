import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch, countWords } from '@/lib/utils'
import { getCreditCost, getUpgradeMessage }                   from '@/lib/credits'
import { buildRepurposePrompt, REPURPOSE_TYPES, REPURPOSE_LABELS, type RepurposeType } from '@/lib/repurpose-prompts'
import { getAnthropicClientForWorkspace }                     from '@/lib/anthropic-byok'
import { getLimiter, checkLimit, rateLimitResponse }          from '@/lib/rate-limit'

// Credits normally throttle this (see creditCost below), but BYOK
// workspaces run creditCost = 0 — for them this is otherwise completely
// unthrottled. A per-user cap independent of the credit system covers
// that gap without changing behavior for anyone paying in credits (this
// limit is generous enough that normal usage never hits it).
const repurposeLimiter = getLimiter('rl:repurpose:user', 30, '1 h')

// POST /api/ai/repurpose
export async function POST(req: NextRequest) {

  // ── 1. Auth ──────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let ws: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    ws = result.workspace
  } catch (e) {
    return workspaceCatch(e)
  }

  const { success, reset } = await checkLimit(repurposeLimiter, user.id)
  if (!success) {
    return rateLimitResponse('Too many repurpose requests. Try again later.', reset)
  }

  // ── 2. Parse & validate body ─────────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const { contentId, repurposeType } = body

  if (!contentId || typeof contentId !== 'string') return jsonError('contentId is required')
  if (!REPURPOSE_TYPES.includes(repurposeType as RepurposeType)) {
    return jsonError(`repurposeType must be one of: ${REPURPOSE_TYPES.join(', ')}`)
  }

  // ── 3. Credit check (repurpose always costs 5 credits) ───────────────────
  const { client: anthropic, isByok } = await getAnthropicClientForWorkspace(ws.id, 'ai/repurpose')
  const creditCost = isByok ? 0 : getCreditCost('', 'repurpose')   // always 5, unless BYOK

  if (!isByok && (ws as any).credits_remaining < creditCost) {
    return new Response(
      JSON.stringify({
        error:             'insufficient_credits',
        credits_remaining: (ws as any).credits_remaining,
        credits_cost:      creditCost,
        plan:              ws.plan,
        message:           getUpgradeMessage((ws as any).credits_remaining, creditCost, ws.plan),
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const admin = createSupabaseAdmin()

  // ── 4. Fetch source content piece ────────────────────────────────────────
  const { data: source, error: srcErr } = await admin
    .from('content_pieces')
    .select('id, content, title, industry, content_type, tone, keyword, workspace_id')
    .eq('id', contentId)
    .eq('workspace_id', ws.id)
    .single()

  if (srcErr || !source)                                    return jsonError('Source content not found or access denied', 404)
  if (!source.content || source.content.trim().length < 50) return jsonError('Source content is too short to repurpose (minimum 50 characters)')

  // ── 5. Build prompt from shared lib ─────────────────────────────────────
  const prompt = buildRepurposePrompt(repurposeType as RepurposeType, source.content, {
    industry:    source.industry    ?? 'General',
    contentType: source.content_type ?? 'Blog Post',
    tone:        source.tone        ?? 'Professional',
    keyword:     source.keyword     ?? '',
    title:       source.title       ?? 'Untitled',
  })

  // ── 6. Stream ────────────────────────────────────────────────────────────
  const encoder = new TextEncoder()
  let fullText  = ''

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          // 6000, not 2048 — same fix as ai/generate/route.ts. Not every
          // repurpose target is short (Twitter thread, social caption) —
          // email newsletter and blog-style targets can run long, and the
          // source content itself can now be up to ~3000 words.
          max_tokens: 6000,
          messages:   [{ role: 'user', content: prompt }],
        })

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`
            ))
          }
        }

        // ── 7. Save repurposed piece + deduct credits ─────────────────────
        if (fullText.trim().length > 0) {
          const wordCount = countWords(fullText)
          const label     = REPURPOSE_LABELS[repurposeType as RepurposeType] ?? repurposeType

          const { data: newPiece } = await admin
            .from('content_pieces')
            .insert({
              workspace_id:   ws.id,
              created_by:     user.id,
              parent_id:      contentId,
              repurpose_type: repurposeType,
              content:        fullText,
              word_count:     wordCount,
              status:         'draft',
              title:          `${label}: ${source.title ?? 'Untitled'}`,
              content_type:   repurposeType,
              industry:       source.industry ?? null,
              tone:           source.tone     ?? null,
              keyword:        source.keyword  ?? null,
            })
            .select('id')
            .single()

          // ── CREDIT DEDUCTION (post-success) ──────────────────────────────
          // Atomic — see migration 026_atomic_credits.sql. BYOK workspaces
          // pay Anthropic directly — credits_remaining is untouched, only
          // usage_count increments for analytics.
          let newBalance = (ws as any).credits_remaining
          if (isByok) {
            // Atomic — same class of bug as deduct_credits() below, fixed
            // the same way (migration 042). Found alongside the identical
            // bug in ai/generate/route.ts during a ruthless adversarial
            // pass — this route had it too.
            await Promise.resolve(admin.rpc('increment_byok_usage_count', { p_workspace_id: ws.id }))
              .catch(e => console.error('[repurpose] BYOK usage_count increment failed:', e))
          } else {
            const { data: deductResult } = await admin.rpc('deduct_credits', {
              p_workspace_id: ws.id,
              p_amount:       creditCost,
            })
            newBalance = deductResult?.[0]?.new_balance ?? (ws as any).credits_remaining
          }

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({
              type:             'done',
              contentId:        newPiece?.id ?? null,
              wordCount,
              repurposeType,
              creditCost,
              creditsRemaining: newBalance,
            })}\n\n`
          ))
        }

      } catch (err: any) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'error', error: err.message ?? 'Repurpose failed' })}\n\n`
        ))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection':        'keep-alive',
    },
  })
}
