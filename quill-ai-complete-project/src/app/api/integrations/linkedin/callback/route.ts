import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { encrypt } from '@/lib/utils'
import { cookies } from 'next/headers'

// GET /api/integrations/linkedin/callback?code=...&state=...
// Completes LinkedIn OAuth 2.0 Authorization Code Flow:
//   1. Validates CSRF state cookie
//   2. Exchanges code for access_token
//   3. Fetches LinkedIn profile via OpenID Connect userinfo endpoint
//   4. Stores AES-256-GCM encrypted credentials in integrations table
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const redirectBase = `${process.env.NEXT_PUBLIC_URL}/settings?tab=integrations`

  // User denied the OAuth prompt or LinkedIn returned an error
  if (error || !code) {
    return NextResponse.redirect(`${redirectBase}&error=linkedin_denied`)
  }

  // ── CSRF validation ──────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const savedState  = cookieStore.get('linkedin_oauth_state')?.value
  cookieStore.delete('linkedin_oauth_state')

  if (!savedState || savedState !== state) {
    console.error('[linkedin/callback] State mismatch — possible CSRF attack')
    return NextResponse.redirect(`${redirectBase}&error=linkedin_state_mismatch`)
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  let user: any
  try { user = await requireUser() }
  catch { return NextResponse.redirect(`${process.env.NEXT_PUBLIC_URL}/login`) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) {
    // requireWorkspace() throws 403 specifically for the pending-deletion
    // gate (migration 028) and 404 for genuine not-found — distinguish by
    // status rather than parsing the body, since a redirect only needs the
    // reason code, not the full scheduledPurgeAt detail.
    const code = e instanceof Response && e.status === 403 ? 'workspace_pending_deletion' : 'no_workspace'
    return NextResponse.redirect(`${redirectBase}&error=${code}`)
  }

  // ── Token exchange ───────────────────────────────────────────────────────
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  `${process.env.NEXT_PUBLIC_URL}/api/integrations/linkedin/callback`,
      client_id:     process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  })

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text()
    console.error('[linkedin/callback] Token exchange failed:', tokenRes.status, errBody)
    return NextResponse.redirect(`${redirectBase}&error=linkedin_token_failed`)
  }

  const tokens = await tokenRes.json()
  // tokens.access_token  — valid for ~60 days
  // tokens.expires_in    — seconds until expiry (typically 5,184,000 = 60 days)
  // tokens.token_type    — 'Bearer'
  // LinkedIn does NOT issue refresh tokens for the w_member_social scope.
  // Users must reconnect manually when the token expires.

  // ── Fetch LinkedIn profile via OpenID Connect userinfo ───────────────────
  // The profile_id (sub) is the LinkedIn member ID used to construct the
  // author URN for UGC Posts: urn:li:person:{sub}
  let profileId   = ''
  let profileName = ''
  try {
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (profileRes.ok) {
      const profile = await profileRes.json()
      profileId   = profile.sub  ?? ''   // LinkedIn member ID
      profileName = profile.name ?? ''   // Full display name
    }
  } catch (profileErr) {
    // Non-fatal — we can still store the token without the profile name.
    // The publish endpoint will fail gracefully if profile_id is empty.
    console.warn('[linkedin/callback] Profile fetch failed (non-fatal):', profileErr)
  }

  // ── Encrypt and store credentials ────────────────────────────────────────
  const encryptedConfig = await encrypt(JSON.stringify({
    access_token: tokens.access_token,
    token_type:   tokens.token_type  ?? 'Bearer',
    expires_at:   Date.now() + (tokens.expires_in ?? 5_184_000) * 1000,
    profile_id:   profileId,
    profile_name: profileName,
  }))

  const admin = createSupabaseAdmin()
  const { error: upsertErr } = await admin
    .from('integrations')
    .upsert({
      workspace_id: workspace.id,
      provider:     'linkedin',
      status:       'connected',
      config:       { encrypted_config: encryptedConfig },
      connected_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,provider' })

  if (upsertErr) {
    console.error('[linkedin/callback] Upsert failed:', upsertErr)
    return NextResponse.redirect(`${redirectBase}&error=linkedin_store_failed`)
  }

  return NextResponse.redirect(`${redirectBase}&connected=linkedin`)
}
