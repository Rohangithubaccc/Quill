import { NextRequest } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'

// ── Scoring weights ────────────────────────────────────────────────────────
// Must sum to 100. Views count least (easy to fake, low intent).
// Shares are the highest-value signal — someone staking their reputation
// on the content by distributing it to their own audience.
const WEIGHTS = {
  view:    5,
  click:  25,
  like:   30,
  share:  40,
} as const

// ── Soft ceilings for normalisation ───────────────────────────────────────
// A piece that hits the ceiling on a given event type scores 100% on that
// dimension. A piece with 2× the ceiling still scores 100% — we clamp at 1.
// These represent healthy 7-day engagement for a well-performing piece.
const CEILINGS = {
  view:   500,
  click:  100,
  like:    50,
  share:   25,
} as const

// ── GET /api/cron/aggregate-engagement ────────────────────────────────────
// Vercel Cron: 0 6 * * 1  (every Monday at 06:00 UTC)
//
// Auth: middleware intercepts all /api/cron/* routes and validates
// x-cron-secret. The check below is an additional in-route defence layer
// so the route cannot be called without the secret even if middleware
// configuration changes.
export async function GET(req: NextRequest) {
  // Verify CRON_SECRET — matches the pattern described in prompt spec.
  // Middleware already blocks unsigned requests to /api/cron/* but we
  // double-check here so the route is safe in isolation.
  const cronSecret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '')

  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
    return jsonError('Unauthorized', 401)
  }

  const admin = createSupabaseAdmin()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // ── 1. Fetch all performance events in the last 7 days ─────────────────
  const { data: events, error: evErr } = await admin
    .from('performance_events')
    .select('content_id, event_type')
    .gte('occurred_at', since)

  if (evErr) {
    console.error('[aggregate-engagement] Failed to fetch events:', evErr)
    return jsonError('Failed to fetch events', 500)
  }

  // ── 2. Count events per content_id per type ─────────────────────────────
  const counts: Record<string, Record<string, number>> = {}

  for (const ev of events ?? []) {
    if (!counts[ev.content_id]) {
      counts[ev.content_id] = { view: 0, click: 0, like: 0, share: 0 }
    }
    if (ev.event_type in counts[ev.content_id]) {
      counts[ev.content_id][ev.event_type]++
    }
  }

  if (Object.keys(counts).length === 0) {
    console.log('[aggregate-engagement] No events to aggregate')
    return jsonOk({ updated: 0, timestamp: new Date().toISOString() })
  }

  // ── 3. Compute engagement_score per content_piece ───────────────────────
  // Score = weighted sum of normalised event counts, each dimension clamped
  // to [0, 1] before multiplying by its weight. Final score is 0–100.
  const updates: { id: string; score: number }[] = []

  for (const [contentId, evCounts] of Object.entries(counts)) {
    let score = 0

    for (const [evType, weight] of Object.entries(WEIGHTS)) {
      const count   = evCounts[evType] ?? 0
      const ceiling = CEILINGS[evType as keyof typeof CEILINGS]
      const normed  = Math.min(count / ceiling, 1)  // clamp to [0.0, 1.0]
      score += normed * weight
    }

    updates.push({ id: contentId, score: Math.round(score * 100) / 100 })
  }

  // ── 4. Batch-update engagement_score on content_pieces ──────────────────
  // Supabase does not support multi-row UPDATE in a single call, so we
  // batch with Promise.all in groups of 20 to avoid exhausting the
  // connection pool on large datasets.
  const BATCH_SIZE = 20
  let updatedCount = 0
  const errors: string[] = []

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch   = updates.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(({ id, score }) =>
        admin
          .from('content_pieces')
          .update({ engagement_score: score })
          .eq('id', id)
      )
    )

    for (const { error } of results) {
      if (error) errors.push(error.message)
      else updatedCount++
    }
  }

  console.log(
    `[aggregate-engagement] Updated ${updatedCount}/${updates.length} pieces.` +
    (errors.length ? ` Errors: ${errors.slice(0, 3).join('; ')}` : '')
  )

  return jsonOk({
    updated:   updatedCount,
    total:     updates.length,
    errors:    errors.length,
    timestamp: new Date().toISOString(),
  })
}
