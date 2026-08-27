import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createSupabaseAdmin } from '@/lib/supabase/server'

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
    // First OAuth login — create workspace
    const name = data.user.user_metadata?.full_name ?? data.user.email?.split('@')[0] ?? 'My Workspace'
    const slug = name.toLowerCase().replace(/[^\w]+/g, '-').substring(0, 30) + '-' + Math.random().toString(36).substring(2, 6)

    const { data: ws } = await admin
      .from('workspaces')
      .insert({ name, slug, plan: 'starter', usage_count: 0, usage_limit: 4 })
      .select()
      .single()

    if (ws) {
      await admin.from('workspace_members').insert({
        workspace_id: ws.id, user_id: data.user.id, role: 'owner', status: 'active',
      })
      cookieStore.set('workspace_id', ws.id, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })
    }
  } else {
    cookieStore.set('workspace_id', existingMember.workspace_id, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })
  }

  return NextResponse.redirect(`${origin}${redirectTo}`)
}
