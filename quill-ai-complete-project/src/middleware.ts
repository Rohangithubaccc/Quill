import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  '/reset-password',
  '/pricing',
  '/privacy',
  '/terms',
  '/try',
  '/verify-email',
]

const AUTH_ROUTES = ['/login', '/signup', '/reset-password']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — IMPORTANT: use getUser() not getSession()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // ── Allow public API routes through without auth check ─────────────────
  if (
    pathname.startsWith('/api/track') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/demo/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return supabaseResponse
  }

  // Allow Stripe webhook without auth
  if (pathname === '/api/stripe/webhook') {
    return supabaseResponse
  }

  // Cron routes: verify CRON_SECRET header
  if (pathname.startsWith('/api/cron/')) {
    const cronSecret = request.headers.get('x-cron-secret')
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return supabaseResponse
  }

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith('/api/')
  )

  // ── Authenticated user visiting auth pages → redirect to dashboard ──────
  if (user && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // ── Unauthenticated user visiting app routes → redirect to login ─────────
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  // ── Email verification gate ───────────────────────────────────────────────
  //
  // If the user is authenticated but their email is not yet confirmed,
  // redirect every app route to /verify-email. This prevents unverified
  // users from accessing /dashboard, /generator, etc.
  //
  // Exclusions (must NOT redirect):
  //   • /verify-email itself — would create an infinite redirect loop
  //   • /api/* routes — server routes handle their own auth; redirecting
  //     here would break the resend-verification endpoint
  //   • /_next/* — Next.js internals, never redirect these
  //   • AUTH_ROUTES (/login, /signup, /reset-password) — public auth pages;
  //     handled by the AUTH_ROUTES check above, but also excluded here
  //     for clarity and defence-in-depth
  //
  // Note: user.email_confirmed_at is null when "Confirm email" is enabled
  // in Supabase Auth settings and the user has not yet clicked the link.
  if (
    user &&
    !user.email_confirmed_at &&
    !pathname.startsWith('/verify-email') &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/_next/') &&
    !AUTH_ROUTES.some((r) => pathname.startsWith(r))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/verify-email'
    url.searchParams.set('email', user.email ?? '')
    return NextResponse.redirect(url)
  }

  // ── Attach workspace_id cookie for authenticated, verified users ──────────
  if (user && user.email_confirmed_at) {
    const workspaceIdCookie = request.cookies.get('workspace_id')
    if (!workspaceIdCookie) {
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (member?.workspace_id) {
        supabaseResponse.cookies.set('workspace_id', member.workspace_id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30, // 30 days
        })
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
