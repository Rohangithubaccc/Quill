import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// GET /api/integrations/linkedin/connect
// Initiates LinkedIn OAuth 2.0 Authorization Code Flow.
// Mirrors the Buffer connect pattern exactly: generate CSRF state,
// store in httpOnly cookie, redirect to LinkedIn authorization endpoint.
export async function GET(req: NextRequest) {
  try { await requireUser() }
  catch { return NextResponse.redirect(new URL('/login', req.url)) }

  // CSRF state token — 16 random bytes = 32 hex chars
  const state       = crypto.randomBytes(16).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set('linkedin_oauth_state', state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   600,  // 10 minutes — user must complete OAuth in this window
    path:     '/',
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri:  `${process.env.NEXT_PUBLIC_URL}/api/integrations/linkedin/callback`,
    state,
    // Scopes needed:
    //   openid profile email  — Sign In with LinkedIn using OpenID Connect product
    //   w_member_social       — Share on LinkedIn product (create UGC posts)
    // Both LinkedIn app products must be active in developer.linkedin.com
    scope: 'openid profile email w_member_social',
  })

  return NextResponse.redirect(
    `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`
  )
}
