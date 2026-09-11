import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { getCreditCost }     from '@/lib/credits'

const ORIGINALITY_API_URL = 'https://api.originality.ai/api/v1/scan/ai'
const CHECK_COOLDOWN_MS   = 24 * 60 * 60 * 1000

// POST /api/content/[id]/plagiarism
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // ── 1. Auth ──────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) {
    return workspaceCatch(e)
  }

  if (!process.env.ORIGINALITY_API_KEY) {
    return jsonError('Plagiarism check not configured — contact support', 503)
  }

  // ── 2. Credit check (2 credits per check) ────────────────────────────────
  // Check BEFORE the DB round-trip to fail fast on empty balance.
  const creditCost = getCreditCost('', 'plagiarism_check')   // always 2

  if ((workspace as any).credits_remaining < creditCost) {
    return new Response(
      JSON.stringify({
        error:             'insufficient_credits',
        credits_remaining: (workspace as any).credits_remaining,
        credits_cost:      creditCost,
        plan:              workspace.plan,
        message:           `Plagiarism checks cost ${creditCost} credits. You have ${(workspace as any).credits_remaining} remaining.`,
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const admin = createSupabaseAdmin()

  // ── 3. Fetch content piece (workspace ownership enforced) ─────────────────
  const { data: piece, error: pieceErr } = await admin
    .from('content_pieces')
    .select(`
      id, content, workspace_id,
      plagiarism_checked_at, plagiarism_score,
      ai_detection_score, plagiarism_report_url
    `)
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single()

  if (pieceErr || !piece) return jsonError('Content not found or access denied', 404)

  if (!piece.content || piece.content.trim().length < 100) {
    return jsonError('Content is too short for a plagiarism check (minimum 100 characters)')
  }

  // ── 4. 24-hour cache — return immediately without API call or credit charge
  if (piece.plagiarism_checked_at) {
    const lastCheck = new Date(piece.plagiarism_checked_at).getTime()
    if (Date.now() - lastCheck < CHECK_COOLDOWN_MS) {
      return jsonOk({
        cached:           true,
        checkedAt:        piece.plagiarism_checked_at,
        originalityScore: piece.plagiarism_score,
        aiScore:          piece.ai_detection_score,
        reportUrl:        piece.plagiarism_report_url,
        nextCheckAt:      new Date(lastCheck + CHECK_COOLDOWN_MS).toISOString(),
        creditCost:       0,   // no charge on cache hit
      })
    }
  }

  // ── 5. Call Originality.ai ────────────────────────────────────────────────
  let origData: any
  try {
    const origRes = await fetch(ORIGINALITY_API_URL, {
      method:  'POST',
      headers: {
        'X-OAI-API-KEY': process.env.ORIGINALITY_API_KEY!,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        content:   piece.content.substring(0, 10000),
        storeScan: true,
        title:     `Quill.AI Check — ${piece.id}`,
      }),
    })

    if (!origRes.ok) {
      const errBody = await origRes.text()
      console.error('[plagiarism] Originality.ai error:', origRes.status, errBody)
      if (origRes.status === 402) return jsonError('Originality.ai credits exhausted — top up at originality.ai', 402)
      if (origRes.status === 429) return jsonError('Plagiarism check rate limit reached — try again in a minute', 429)
      if (origRes.status === 401) return jsonError('Originality.ai API key invalid — check ORIGINALITY_API_KEY in env', 503)
      return jsonError('Plagiarism check failed — please try again', 500)
    }

    origData = await origRes.json()
  } catch (fetchErr: any) {
    console.error('[plagiarism] Originality.ai fetch failed:', fetchErr)
    return jsonError('Could not reach Originality.ai — please try again', 503)
  }

  // ── 6. Parse scores ───────────────────────────────────────────────────────
  const aiScore          = Math.round((origData?.score?.ai       ?? 0) * 100)
  const originalityScore = Math.round((origData?.score?.original ?? 0) * 100)
  const reportUrl        = origData?.reportUrl ?? origData?.report_url ?? null
  const checkedAt        = new Date().toISOString()

  // ── 7. Persist results + deduct credits (both only on success) ────────────
  // CRITICAL: deduct AFTER the external API succeeds.
  // A failed Originality.ai call must never cost the user credits.
  const [, deductResponse] = await Promise.all([
    admin.from('content_pieces').update({
      plagiarism_checked_at: checkedAt,
      plagiarism_score:      originalityScore,
      ai_detection_score:    aiScore,
      plagiarism_report_url: reportUrl,
    }).eq('id', piece.id),

    // Atomic — see migration 026_atomic_credits.sql.
    admin.rpc('deduct_credits', { p_workspace_id: workspace.id, p_amount: creditCost }),
  ])
  const newBalance = (deductResponse as any)?.data?.[0]?.new_balance ?? (workspace as any).credits_remaining

  return jsonOk({
    cached:           false,
    checkedAt,
    originalityScore,
    aiScore,
    reportUrl,
    nextCheckAt:      new Date(Date.now() + CHECK_COOLDOWN_MS).toISOString(),
    creditCost,
    creditsRemaining: newBalance,
  })
}
