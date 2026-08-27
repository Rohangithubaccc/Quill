import { NextRequest } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const checks: Record<string, 'ok' | 'error'> = {}

  // ── Database check ────────────────────────────────────────────────────
  try {
    const admin = createSupabaseAdmin()
    const { error } = await admin.from('workspaces').select('id').limit(1)
    checks.database = error ? 'error' : 'ok'
  } catch {
    checks.database = 'error'
  }

  // ── Anthropic check (minimal — just verify env var is set) ────────────
  // We don't make an actual API call on every health check (too expensive).
  // Just verify the key is configured. A failed generation would surface
  // Anthropic issues via Sentry anyway.
  checks.anthropic = process.env.ANTHROPIC_API_KEY ? 'ok' : 'error'

  // ── Supabase env check ────────────────────────────────────────────────
  checks.supabase_config =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? 'ok'
      : 'error'

  const allOk = Object.values(checks).every(v => v === 'ok')
  const status = allOk ? 'ok' : 'degraded'

  return new Response(
    JSON.stringify({
      status,
      timestamp: new Date().toISOString(),
      checks,
      version: process.env.npm_package_version ?? '1.0.0',
      environment: process.env.NODE_ENV,
    }),
    {
      status: allOk ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  )
}
