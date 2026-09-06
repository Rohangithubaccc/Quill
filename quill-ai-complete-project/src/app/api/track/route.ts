import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getLimiter, checkLimit } from '@/lib/rate-limit'

// 100 req/min per IP (public endpoint — no auth)
const limiter = getLimiter('rl:track:ip', 100, '1 m')

const TrackSchema = z.object({
  contentId: z.string().uuid(),
  eventType: z.enum(['view', 'click', 'share', 'like', 'comment', 'conversion']),
  platform: z.string().max(50).optional(),
  metadata: z.record(z.unknown()).optional().default({}),
})

// Fix import — utils doesn't export createSupabaseAdmin
import { createClient } from '@supabase/supabase-js'
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { success } = await checkLimit(limiter, ip)
  if (!success) {
    return new Response(null, { status: 429 })
  }

  let body: z.infer<typeof TrackSchema>
  try {
    body = TrackSchema.parse(await req.json())
  } catch {
    return new Response(null, { status: 400 })
  }

  const admin = adminClient()

  // Verify content exists (don't allow tracking phantom IDs)
  const { data: piece, error } = await admin
    .from('content_pieces')
    .select('id')
    .eq('id', body.contentId)
    .single()

  if (error || !piece) {
    return new Response(null, { status: 404 })
  }

  await admin.from('performance_events').insert({
    content_id: body.contentId,
    event_type: body.eventType,
    platform: body.platform ?? null,
    metadata: body.metadata,
    occurred_at: new Date().toISOString(),
  })

  // ── Immediate score bump for high-value events ──────────────────────────
  // Share and like events are the strongest engagement signals. Rather than
  // waiting for the weekly Monday cron to reflect them in the score, we
  // apply an incremental bump immediately so the performance page shows
  // near-real-time data for the events that matter most.
  //
  // The cron will overwrite this with a fully-recalculated score on Monday,
  // so bumps are always eventually corrected — never permanently inflated.
  if (['share', 'like'].includes(body.eventType)) {
    const { data: scored } = await admin
      .from('content_pieces')
      .select('engagement_score')
      .eq('id', body.contentId)
      .single()

    if (scored) {
      const currentScore = scored.engagement_score ?? 0
      const increment    = body.eventType === 'share' ? 2.5 : 1.5
      const newScore     = Math.min(100, Math.round((currentScore + increment) * 100) / 100)
      await admin
        .from('content_pieces')
        .update({ engagement_score: newScore })
        .eq('id', body.contentId)
    }
  }

  return new Response(null, { status: 204 })
}

// GET: tracking pixel (1×1 transparent GIF)
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { success } = await checkLimit(limiter, ip)

  const { searchParams } = new URL(req.url)
  const contentId = searchParams.get('c')

  if (success && contentId) {
    const admin = adminClient()
    const { data: piece } = await admin
      .from('content_pieces')
      .select('id')
      .eq('id', contentId)
      .single()

    if (piece) {
      await admin.from('performance_events').insert({
        content_id: contentId,
        event_type: 'view',
        platform: 'blog',
        metadata: {
          referrer: req.headers.get('referer') ?? '',
          ua: req.headers.get('user-agent')?.substring(0, 200) ?? '',
        },
        occurred_at: new Date().toISOString(),
      })
    }
  }

  // Return 1×1 transparent GIF
  const gif = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  )

  return new Response(gif, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
  })
}
