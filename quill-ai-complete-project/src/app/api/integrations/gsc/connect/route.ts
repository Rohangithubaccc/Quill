import { NextRequest } from 'next/server'
import { requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch } from '@/lib/utils'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// GET /api/integrations/gsc/connect
// Initiates Google OAuth 2.0 with offline access.
// Redirects the user to Google's consent screen.
// Requires: GOOGLE_CLIENT_ID, NEXT_PUBLIC_URL in environment.
export async function GET(_req: NextRequest) {
  // ── 1. Auth guard ─────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  try { await requireWorkspace(user.id) }
  catch (e) { return workspaceCatch(e) }

  if (!process.env.GOOGLE_CLIENT_ID) {
    return jsonError('Google OAuth not configured — contact support', 503)
  }

  // ── 2. Generate CSRF state token ──────────────────────────────────────────
  // A random 32-byte hex string. Stored in a short-lived cookie and verified
  // in the callback to prevent CSRF attacks on the OAuth redirect.
  const state = crypto.randomBytes(32).toString('hex')

  const cookieStore = await cookies()
  cookieStore.set('gsc_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   600,          // 10 minutes — plenty of time to complete auth
    path:     '/',
    secure:   process.env.NODE_ENV === 'production',
  })

  // ── 3. Build Google authorization URL ────────────────────────────────────
  const redirectUri = `${process.env.NEXT_PUBLIC_URL}/api/integrations/gsc/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    state,
    scope:         'https://www.googleapis.com/auth/webmasters.readonly',
    access_type:   'offline',   // CRITICAL — gets refresh_token in response
    prompt:        'consent',   // CRITICAL — forces refresh_token even if previously authorized
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`

  return Response.redirect(authUrl)
}
