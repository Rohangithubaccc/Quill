import { NextRequest }      from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk }   from '@/lib/utils'

// GET /api/cron/reset-usage
// Schedule: 0 0 1 * *  (midnight UTC on the 1st of every month)
// Vercel Cron calls this with the x-cron-secret header.
//
// Resets both usage_count (analytics) and credits_remaining (billing)
// for all non-cancelled workspaces using an atomic Postgres function.
// See: supabase/migrations/012_credits.sql for the function definition.
//
// Why a Postgres function? Supabase JS .update() cannot set one column
// to the value of another column in the same row in a single statement.
// credits_remaining must be reset to credits_monthly (which varies per
// workspace), so we need SQL: SET credits_remaining = credits_monthly.

export async function GET(req: NextRequest) {
  // ── Cron auth (Vercel sets this header automatically) ─────────────────────
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '')

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError('Unauthorized', 401)
  }

  const admin = createSupabaseAdmin()

  // ── Call the atomic reset function ────────────────────────────────────────
  // reset_monthly_credits() defined in migration 012:
  //   UPDATE workspaces
  //   SET usage_count = 0, credits_remaining = credits_monthly
  //   WHERE plan NOT IN ('cancelled')
  const { error } = await admin.rpc('reset_monthly_credits')

  if (error) {
    console.error('[Cron] reset_monthly_credits failed:', error)
    return jsonError('Reset failed: ' + error.message, 500)
  }

  const timestamp = new Date().toISOString()
  console.log(`[Cron] Monthly credits reset at ${timestamp}`)

  return jsonOk({ reset: true, timestamp })
}
