import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { encrypt, decrypt, jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { z } from 'zod'

// ── OAuth Callback ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_URL}/login`)
  }

  const { searchParams } = new URL(req.url)
  const code       = searchParams.get('code')
  const state      = searchParams.get('state')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_URL}/settings?error=buffer_denied`
    )
  }

  // ── Verify CSRF state ──────────────────────────────────────────────────
  const cookieStore  = await cookies()
  const storedState  = cookieStore.get('buffer_oauth_state')?.value

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_URL}/settings?error=buffer_state_mismatch`
    )
  }

  // Clear state cookie
  cookieStore.delete('buffer_oauth_state')

  // ── Exchange code for access_token + refresh_token ─────────────────────
  // Buffer returns both tokens in the same response. We store both so the
  // refresh flow (src/lib/buffer.ts → refreshBufferToken) can obtain a new
  // access_token when the current one expires (~60 days).
  const tokenRes = await fetch('https://api.bufferapp.com/1/oauth2/token.json', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     process.env.BUFFER_CLIENT_ID!,
      client_secret: process.env.BUFFER_CLIENT_SECRET!,
      redirect_uri:  `${process.env.NEXT_PUBLIC_URL}/api/integrations/buffer/callback`,
      code,
      grant_type:    'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('[Buffer] Token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_URL}/settings?error=buffer_token_failed`
    )
  }

  // Capture both tokens plus expiry metadata
  const tokens = await tokenRes.json() as {
    access_token:  string
    refresh_token: string
    token_type:    string
    expires_in?:   number
  }

  if (!tokens.access_token) {
    console.error('[Buffer] No access_token in token response')
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_URL}/settings?error=buffer_token_failed`
    )
  }

  // ── Fetch connected profiles ───────────────────────────────────────────
  const profilesRes = await fetch('https://api.bufferapp.com/1/profiles.json', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  type BufferProfile = {
    id: string; service: string
    service_username: string; formatted_username: string
  }
  const profiles: BufferProfile[] = profilesRes.ok ? await profilesRes.json() : []
  const profileIds = profiles.map((p) => p.id)

  // ── Save encrypted credentials to DB ──────────────────────────────────
  // We store a single encrypted JSON blob containing both tokens plus the
  // expiry timestamp. This avoids multiple DB columns for OAuth state and
  // keeps the schema stable if Buffer adds more token fields in future.
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const encryptedConfig = await encrypt(JSON.stringify({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type:    tokens.token_type   ?? 'Bearer',
    // expires_in is in seconds; Buffer typically returns 5_184_000 (60 days).
    // Default to 60 days if the field is absent to be conservative.
    expires_at:    Date.now() + (tokens.expires_in ?? 5_184_000) * 1000,
    profiles:      profileIds,
  }))

  const admin = createSupabaseAdmin()

  await admin.from('integrations').upsert(
    {
      workspace_id: workspace.id,
      provider:     'buffer',
      config: {
        // encrypted_config holds the full JSON blob (replaces old encrypted_token)
        encrypted_config: encryptedConfig,
        // Public profile metadata for display in the Settings UI (not secret)
        profiles: profiles.map((p) => ({
          id:       p.id,
          service:  p.service,
          username: p.service_username || p.formatted_username,
        })),
      },
      status:       'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,provider' }
  )

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_URL}/settings?connected=buffer`
  )
}

// ── Schedule post via Buffer (legacy endpoint — kept for backwards compat) ──
// New integrations should use POST /api/integrations/buffer/publish instead.
// This POST handler is preserved so existing calendar integrations that call
// this callback URL directly continue to work.
const ScheduleSchema = z.object({
  contentId:       z.string().uuid().optional(),
  text:            z.string().min(1).max(2000),
  profileIds:      z.array(z.string()).min(1),
  scheduledAt:     z.string().datetime(),
  calendarEventId: z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let body: z.infer<typeof ScheduleSchema>
  try { body = ScheduleSchema.parse(await req.json()) } catch (e) {
    return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body')
  }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()

  // ── Fetch + decrypt Buffer token ───────────────────────────────────────
  // Handle both the new encrypted_config format (with refresh_token) and
  // the legacy encrypted_token format for accounts connected before this
  // migration.
  const { data: integration } = await admin
    .from('integrations')
    .select('config, status')
    .eq('workspace_id', workspace.id)
    .eq('provider', 'buffer')
    .single()

  if (!integration || integration.status !== 'connected') {
    return jsonError('Buffer is not connected. Go to Settings → Integrations.', 400)
  }

  const config = integration.config as Record<string, string>

  let accessToken: string
  if (config.encrypted_config) {
    // New format: decrypt the JSON blob and extract access_token
    const creds = JSON.parse(await decrypt(config.encrypted_config))
    accessToken = creds.access_token
  } else {
    // Legacy format: single encrypted token
    accessToken = await decrypt(config.encrypted_token)
  }

  // ── Create Buffer updates ──────────────────────────────────────────────
  const results: { profileId: string; updateId?: string; error?: string }[] = []

  for (const profileId of body.profileIds) {
    const formData = new URLSearchParams()
    formData.append('profile_ids[]', profileId)
    formData.append('text', body.text)
    formData.append('scheduled_at', body.scheduledAt)
    formData.append('access_token', accessToken)

    const res = await fetch('https://api.bufferapp.com/1/updates/create.json', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    formData,
    })

    if (res.ok) {
      const data = await res.json() as { updates?: { id: string }[] }
      const updateId = data.updates?.[0]?.id
      results.push({ profileId, updateId })
    } else {
      const err = await res.json().catch(() => ({})) as { message?: string }
      results.push({ profileId, error: err.message ?? `HTTP ${res.status}` })
    }

    // Buffer rate limit: 60 req/min — courtesy delay when batching
    if (body.profileIds.length > 1) {
      await new Promise((r) => setTimeout(r, 1050))
    }
  }

  // ── Update calendar event status ───────────────────────────────────────
  if (body.calendarEventId) {
    await admin
      .from('calendar_events')
      .update({ status: 'scheduled' })
      .eq('id', body.calendarEventId)
  }

  // ── Update content piece status ────────────────────────────────────────
  if (body.contentId) {
    await admin
      .from('content_pieces')
      .update({ status: 'scheduled' })
      .eq('id', body.contentId)
  }

  const successCount = results.filter((r) => !r.error).length
  return jsonOk({ scheduled: successCount, total: body.profileIds.length, results })
}
