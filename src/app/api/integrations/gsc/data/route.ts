import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { decrypt, encrypt, jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// GET /api/integrations/gsc/data?url=...&days=28
//
// Fetches Google Search Console keyword performance data for a specific
// published page URL. Returns the top 10 keywords ranked by impressions.
//
// Auto-refreshes the access_token if it's about to expire (< 60 seconds).
// The refresh_token is persistent — it never expires unless the user revokes
// access in their Google account.
//
// Error codes:
//   400 — GSC not connected or url param missing
//   401 — gsc_auth_expired (encrypted config corrupt / missing refresh_token)
//   403 — page URL not verified in Search Console
//   500 — GSC API or internal error
export async function GET(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) {
    return workspaceCatch(e)
  }

  // ── 2. Parse query params ─────────────────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const pageUrl = searchParams.get('url')
  const days    = Math.min(Math.max(parseInt(searchParams.get('days') ?? '28', 10), 1), 90)

  if (!pageUrl) {
    return jsonError('url parameter required', 400)
  }

  // Validate URL format
  try { new URL(pageUrl) }
  catch { return jsonError('Invalid page URL — must be a fully qualified URL (https://...)', 400) }

  // ── 3. Fetch GSC integration record ───────────────────────────────────────
  const admin = createSupabaseAdmin()

  const { data: integration, error: integrationErr } = await admin
    .from('integrations')
    .select('config, status')
    .eq('workspace_id', workspace.id)
    .eq('provider', 'gsc')
    .single()

  if (integrationErr || !integration) {
    return jsonError('GSC not connected — connect via Settings → Integrations', 400)
  }

  if (integration.status !== 'connected') {
    return jsonError('GSC integration is disconnected — reconnect in Settings', 400)
  }

  // ── 4. Decrypt credentials ────────────────────────────────────────────────
  let creds: {
    access_token:  string
    refresh_token: string
    expires_at:    number
    token_type:    string
    sites:         Array<{ siteUrl: string; permissionLevel: string }>
  }

  try {
    creds = JSON.parse(await decrypt(integration.config.encrypted_config))
  } catch (err) {
    console.error('[gsc/data] Decrypt failed:', err)
    return jsonError('gsc_auth_expired', 401)
  }

  if (!creds.refresh_token) {
    return jsonError('gsc_auth_expired', 401)
  }

  // ── 5. Token refresh (if expiring within 60 seconds) ──────────────────────
  // Google access tokens live for 3600 seconds. We refresh proactively to
  // avoid a mid-request expiry. The refresh_token itself does not expire.
  if (creds.expires_at < Date.now() + 60_000) {
    try {
      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          client_id:     process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: creds.refresh_token,
          grant_type:    'refresh_token',
        }),
      })

      if (refreshRes.ok) {
        const newTokens = await refreshRes.json()
        creds.access_token = newTokens.access_token
        creds.expires_at   = Date.now() + (newTokens.expires_in ?? 3600) * 1000

        // Persist refreshed token — fire-and-forget, don't block the response
        encrypt(JSON.stringify(creds))
          .then(newEncrypted =>
            admin
              .from('integrations')
              .update({ config: { encrypted_config: newEncrypted } })
              .eq('workspace_id', workspace.id)
              .eq('provider', 'gsc')
          )
          .catch(err => console.error('[gsc/data] Token persist failed (non-fatal):', err))
      } else {
        // Refresh failed — log but proceed with existing token. It might still
        // have seconds left; the GSC call will 401 if it really is expired.
        const errBody = await refreshRes.text()
        console.error('[gsc/data] Token refresh failed:', refreshRes.status, errBody)
      }
    } catch (err) {
      console.error('[gsc/data] Token refresh network error (non-fatal):', err)
    }
  }

  // ── 6. Determine GSC site URL ──────────────────────────────────────────────
  // The GSC API requires requests scoped to a verified site URL.
  // Extract the origin (scheme + hostname) from the page URL.
  // GSC stores sites with a trailing slash: "https://example.com/"
  let siteUrl: string
  try {
    const parsed = new URL(pageUrl)
    siteUrl = `${parsed.protocol}//${parsed.hostname}/`
  } catch {
    return jsonError('Could not extract site URL from page URL', 400)
  }

  // ── 7. Call GSC Search Analytics API ──────────────────────────────────────
  const endDate   = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0]

  const gscApiUrl =
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`

  let gscData: any
  try {
    const gscRes = await fetch(gscApiUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${creds.access_token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['query'],      // group results by search query (keyword)
        dimensionFilterGroups: [{
          filters: [{
            dimension:  'page',
            operator:   'equals',
            expression: pageUrl,
          }],
        }],
        rowLimit:   10,             // top 10 keywords for this specific page
        dataState:  'all',          // include data still being processed
      }),
    })

    if (!gscRes.ok) {
      const errText = await gscRes.text()
      console.error('[gsc/data] GSC API error:', gscRes.status, errText)

      if (gscRes.status === 401) {
        // Mark integration as needing re-auth
        await admin
          .from('integrations')
          .update({ status: 'expired' })
          .eq('workspace_id', workspace.id)
          .eq('provider', 'gsc')
        return jsonError('gsc_auth_expired', 401)
      }

      if (gscRes.status === 403) {
        return jsonError(
          'GSC access denied — verify this site is added and ownership confirmed in Google Search Console',
          403
        )
      }

      if (gscRes.status === 429) {
        return jsonError('Google Search Console rate limit reached — try again in a minute', 429)
      }

      return jsonError('Failed to fetch GSC data — please try again', 500)
    }

    gscData = await gscRes.json()
  } catch (err) {
    console.error('[gsc/data] GSC API network error:', err)
    return jsonError('Could not reach Google Search Console — please try again', 503)
  }

  // ── 8. Transform response ──────────────────────────────────────────────────
  // GSC response shape:
  // {
  //   rows: [{ keys: ['keyword string'], clicks, impressions, ctr, position }],
  //   rowCount: number
  // }
  //
  // ctr is 0.0–1.0 (convert to percentage with 1 decimal place)
  // position is avg ranking position (1 = top result), 1 decimal place
  //
  // If no rows exist, the page has no search data for this date range.
  // This is normal for newly published content — it takes days/weeks to index.
  const rows = (gscData.rows ?? []).map((row: any) => ({
    keyword:     row.keys[0],
    clicks:      Math.round(row.clicks      ?? 0),
    impressions: Math.round(row.impressions ?? 0),
    ctr:         Math.round((row.ctr        ?? 0) * 1000) / 10,    // e.g. 0.0523 → 5.2
    position:    Math.round((row.position   ?? 0) * 10)  / 10,     // e.g. 4.678 → 4.7
  }))

  // Already sorted by impressions DESC by default from GSC,
  // but enforce it explicitly in case the API changes.
  rows.sort((a: any, b: any) => b.impressions - a.impressions)

  // Aggregate totals across all returned keywords for this page
  const totals = rows.reduce(
    (acc: any, row: any) => ({
      clicks:      acc.clicks      + row.clicks,
      impressions: acc.impressions + row.impressions,
    }),
    { clicks: 0, impressions: 0 }
  )

  return jsonOk({
    pageUrl,
    siteUrl,
    startDate,
    endDate,
    days,
    rows,
    totalRows:        gscData.rowCount ?? rows.length,
    totals,
    // Convenience: top keyword for the summary line in the UI
    topKeyword: rows[0] ?? null,
    noDataYet:  rows.length === 0,  // page exists but no search data yet
  })
}
