import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { PLAN_CREDITS } from '@/lib/credits'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // Ensure workspace exists for OAuth signups
  const admin = createSupabaseAdmin()
  const { data: existingMember } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', data.user.id)
    .eq('status', 'active')
    .limit(1)
    .single()

  if (!existingMember) {
    // First OAuth login — create workspace.
    //
    // Brought in line with the email/password signup route's workspace
    // creation (src/app/api/auth/signup/route.ts) during a ruthless
    // review — this branch previously had neither: no retry-on-conflict
    // (the random 4-char suffix baked into the slug up front makes
    // collisions less likely than the signup route's bare-name-first
    // approach, but not impossible — 36^4 possibilities, non-negligible
    // at real scale) and, worse, no error handling at all. The insert's
    // own `error` wasn't even destructured; a failed insert for any
    // reason left `ws` undefined, and the code still fell through to an
    // unconditional redirect to /dashboard — a real user landing on a
    // broken dashboard with no workspace, no workspace_members row, and
    // no error surfaced anywhere. Same retry-then-fail-loudly shape as
    // the signup route now, not a silent dead end.
    const name = data.user.user_metadata?.full_name ?? data.user.email?.split('@')[0] ?? 'My Workspace'
    const baseSlug = name.toLowerCase().replace(/[^\w]+/g, '-').substring(0, 30)
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

    let ws: any = null
    let wsErr: any = null
    const MAX_SLUG_ATTEMPTS = 5

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const candidateSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`
      const { data: inserted, error } = await admin
        .from('workspaces')
        .insert({
          name, slug: candidateSlug, plan: 'starter', usage_count: 0, usage_limit: 12,
          credits_monthly: PLAN_CREDITS.starter,
          credits_remaining: PLAN_CREDITS.starter,
          trial_ends_at: trialEndsAt,
          subscription_status: 'trialing',
        })
        .select()
        .single()

      if (!error) { ws = inserted; wsErr = null; break }
      wsErr = error
      const isSlugCollision =
        error.message?.includes('duplicate') || error.message?.includes('unique') || (error as any).code === '23505'
      if (!isSlugCollision) break
    }

    if (wsErr || !ws) {
      console.error('[auth/callback] Failed to create workspace for OAuth user:', data.user.id, wsErr)
      return NextResponse.redirect(`${origin}/login?error=workspace_creation_failed`)
    }

    const { error: memberErr } = await admin.from('workspace_members').insert({
      workspace_id: ws.id, user_id: data.user.id, role: 'owner', status: 'active',
    })

    if (memberErr) {
      console.error('[auth/callback] Failed to create workspace_members for OAuth user:', data.user.id, memberErr)
      await admin.from('workspaces').delete().eq('id', ws.id)
      return NextResponse.redirect(`${origin}/login?error=workspace_creation_failed`)
    }

    cookieStore.set('workspace_id', ws.id, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })
  } else {
    cookieStore.set('workspace_id', existingMember.workspace_id, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })
  }

  return NextResponse.redirect(`${origin}${redirectTo}`)
}
