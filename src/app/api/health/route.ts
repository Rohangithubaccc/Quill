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

  // ── Platform AI provider check (minimal — just verify env vars are set) ─
  // We don't make an actual API call on every health check (too expensive).
  // Just verify config is present. Provider-agnostic now — whichever
  // provider PLATFORM_AI_PROVIDER points at (defaults to 'anthropic'). A
  // failed generation would surface real provider issues via Sentry anyway.
  checks.platformAi = process.env.PLATFORM_AI_API_KEY && process.env.PLATFORM_AI_MODEL ? 'ok' : 'error'

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
