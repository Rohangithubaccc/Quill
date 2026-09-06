import { NextRequest } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'

// Retention window: delete stripe_events rows older than this many days.
// Stripe only retries webhook deliveries for up to 3 days, so any row
// older than 90 days is safely past any possible retry window.
const RETENTION_DAYS = 90

export async function GET(req: NextRequest) {
  // ── Auth: verify CRON_SECRET header ───────────────────────────────────
  //
  // Vercel Cron calls this route as a GET with the Authorization header
  // set to the CRON_SECRET value. The middleware also enforces this for
  // all /api/cron/* routes, but we double-check here as defence-in-depth.
  const cronSecret = req.headers.get('x-cron-secret') ??
                     req.headers.get('authorization')?.replace('Bearer ', '')

  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
    console.error('[Cron] cleanup-stripe-events: unauthorized request')
    return jsonError('Unauthorized', 401)
  }

  const admin = createSupabaseAdmin()

  // Compute the cutoff timestamp: rows with processed_at before this
  // are eligible for deletion.
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // ── Delete old rows ────────────────────────────────────────────────────
  //
  // Supabase's .delete() requires a .lt() / .eq() / etc. filter —
  // it will not delete all rows without a condition (safety feature).
  // The idx_stripe_events_processed index makes this range delete fast.
  const { error, count } = await admin
    .from('stripe_events')
    .delete({ count: 'exact' })
    .lt('processed_at', cutoff)

  if (error) {
    console.error('[Cron] cleanup-stripe-events: delete failed:', error.message)
    return jsonError('Cleanup failed: ' + error.message, 500)
  }

  const deleted = count ?? 0
  const timestamp = new Date().toISOString()

  console.log(
    `[Cron] cleanup-stripe-events: deleted ${deleted} rows ` +
    `older than ${RETENTION_DAYS} days (cutoff: ${cutoff}) at ${timestamp}`
  )

  return jsonOk({
    cleaned:       true,
    deleted,
    cutoff,
    retentionDays: RETENTION_DAYS,
    timestamp,
  })
}
