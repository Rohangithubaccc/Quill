import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { encrypt, jsonError } from '@/lib/utils'
import { cookies } from 'next/headers'

// GET /api/integrations/gsc/callback?code=...&state=...
// Handles Google OAuth 2.0 callback.
// Exchanges the authorization code for tokens, fetches the user's GSC site
// list, persists everything encrypted, then redirects to settings.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')

  const settingsUrl  = `${process.env.NEXT_PUBLIC_URL}/settings?tab=integrations`
  const errorRedirect = (msg: string) =>
    Response.redirect(`${settingsUrl}&error=${encodeURIComponent(msg)}`)

  // ── 1. Auth guard ─────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return errorRedirect('Session expired — please log in again') }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) {
    // Same distinction as the LinkedIn callback, same code, so the
    // frontend maps both through a single table.
    return errorRedirect(e instanceof Response && e.status === 403 ? 'workspace_pending_deletion' : 'Workspace not found')
  }

  // ── 2. Validate CSRF state cookie ─────────────────────────────────────────
  const cookieStore = await cookies()
  const storedState = cookieStore.get('gsc_oauth_state')?.value

  if (!storedState || storedState !== state) {
    console.error('[gsc/callback] State mismatch — possible CSRF attack', { storedState, state })
    return errorRedirect('OAuth state mismatch — please try connecting again')
  }

  // Clear the state cookie immediately — one-time use
  cookieStore.set('gsc_oauth_state', '', { maxAge: 0, path: '/' })

  if (!code) {
    return errorRedirect('Authorization cancelled or denied')
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return errorRedirect('Google OAuth not configured')
  }

  // ── 3. Exchange authorization code for tokens ─────────────────────────────
  const redirectUri = `${process.env.NEXT_PUBLIC_URL}/api/integrations/gsc/callback`

  let tokenData: {
    access_token:  string
    refresh_token: string
    expires_in:    number
    token_type:    string
    error?:        string
    error_description?: string
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    })

    tokenData = await tokenRes.json()

    if (!tokenRes.ok || tokenData.error) {
      console.error('[gsc/callback] Token exchange failed:', tokenData)
      return errorRedirect(tokenData.error_description ?? 'Token exchange failed')
    }
  } catch (err) {
    console.error('[gsc/callback] Token exchange network error:', err)
    return errorRedirect('Could not reach Google — please try again')
  }

  if (!tokenData.refresh_token) {
    // This happens when access_type='offline' + prompt='consent' is not set correctly,
    // or if the user has previously authorized and the token was already issued.
    // The connect route uses prompt=consent to force it, but guard here defensively.
    console.error('[gsc/callback] No refresh_token in response — access_type or prompt misconfigured')
    return errorRedirect('Google did not return a refresh token — please try connecting again')
  }

  // ── 4. Fetch user's GSC site list ─────────────────────────────────────────
  // Pre-populate so the settings UI can show a site selector immediately.
  let sites: Array<{ siteUrl: string; permissionLevel: string }> = []

  try {
    const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    })

    if (sitesRes.ok) {
      const sitesData = await sitesRes.json()
      sites = (sitesData.siteEntry ?? []).map((s: any) => ({
        siteUrl:         s.siteUrl,
        permissionLevel: s.permissionLevel,
      }))
    } else {
      // Non-fatal — user can add site URL manually in settings
      console.warn('[gsc/callback] Sites fetch failed:', sitesRes.status)
    }
  } catch (err) {
    console.warn('[gsc/callback] Sites fetch network error (non-fatal):', err)
  }

  // ── 5. Encrypt and persist credentials ───────────────────────────────────
  // Stored as: { encrypted_config: "<encrypted JSON string>" }
  // The encrypted JSON contains all sensitive tokens + the sites list.
  const credentialsPayload = {
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token,       // never expires — guard it carefully
    expires_at:    Date.now() + tokenData.expires_in * 1000,
    token_type:    tokenData.token_type ?? 'Bearer',
    sites,
  }

  let encryptedConfig: string
  try {
    encryptedConfig = await encrypt(JSON.stringify(credentialsPayload))
  } catch (err) {
    console.error('[gsc/callback] Encryption failed:', err)
    return errorRedirect('Failed to store credentials securely — contact support')
  }

  const admin = createSupabaseAdmin()

  const { error: upsertErr } = await admin
    .from('integrations')
    .upsert(
      {
        workspace_id:  workspace.id,
        provider:      'gsc',
        status:        'connected',
        config:        { encrypted_config: encryptedConfig },
        connected_at:  new Date().toISOString(),
      },
      { onConflict: 'workspace_id,provider' }
    )

  if (upsertErr) {
    console.error('[gsc/callback] DB upsert error:', upsertErr)
    return errorRedirect('Failed to save integration — please try again')
  }

  // ── 6. Redirect to settings with success flag ─────────────────────────────
  return Response.redirect(`${settingsUrl}&connected=gsc`)
}
