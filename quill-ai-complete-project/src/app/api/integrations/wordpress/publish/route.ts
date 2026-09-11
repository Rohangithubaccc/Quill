import { NextRequest }  from 'next/server'
import { z }            from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { decrypt, encrypt, jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'
import { dispatchWebhook }                                    from '@/lib/webhooks'
import { assertSafeUrl, safeFetch, UnsafeUrlError } from '@/lib/url-safety'

const PublishSchema = z.object({
  contentId:      z.string().uuid().optional(),
  title:          z.string().min(1).max(300),
  content:        z.string().min(1),
  status:         z.enum(['draft','publish','future']).default('draft'),
  // Already gated by assertSafeUrl() before use below (rejects
  // non-http(s) schemes as part of its SSRF checks), but validating the
  // scheme here too means a bad value fails fast with a clear message
  // instead of only surfacing downstream.
  headerImageUrl: z.string().url().refine(
    u => { try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:' } catch { return false } },
    'URL must use http or https',
  ).optional(),
})

const ConnectSchema = z.object({
  siteUrl:     z.string().url('Enter a valid site URL, e.g. https://yourblog.com'),
  username:    z.string().min(1).max(200),
  appPassword: z.string().min(1).max(500),
})

// PUT /api/integrations/wordpress/publish — save/update WordPress credentials.
// (Lives in this file rather than a separate connect/route.ts because the
// Settings UI's connect form already targets this exact path+method.)
export async function PUT(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner','admin'].includes(role)) return jsonError('Owners and admins only', 403)

  let body: z.infer<typeof ConnectSchema>
  try { body = ConnectSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  // SSRF guard: every subsequent publish/media-upload call to this
  // workspace fetches `${site_url}/wp-json/...` server-side, so a bad
  // site_url here is a standing SSRF vector for as long as the
  // integration stays connected — reject it at save time, not just at
  // use time (the publish route below re-validates too, defense in depth).
  try {
    await assertSafeUrl(body.siteUrl)
  } catch (e) {
    return jsonError(e instanceof UnsafeUrlError ? `Site URL: ${e.message}` : 'Invalid site URL', 400)
  }

  const siteUrl = body.siteUrl.replace(/\/+$/, '')  // strip trailing slash(es) for clean URL joins later
  const encryptedConfig = await encrypt(JSON.stringify({
    site_url:     siteUrl,
    username:     body.username,
    app_password: body.appPassword,
  }))

  const admin = createSupabaseAdmin()
  const { error } = await admin.from('integrations').upsert(
    {
      workspace_id: workspace.id,
      provider:     'wordpress',
      config:       { encrypted_config: encryptedConfig, site_url: siteUrl },
      status:       'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,provider' },
  )

  if (error) return dbError('integrations/wordpress/publish', error, 'Failed to save WordPress connection. Please try again.', 500)
  return jsonOk({ connected: true })
}

// POST /api/integrations/wordpress/publish
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  let body: z.infer<typeof PublishSchema>
  try { body = PublishSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  // Fetch WordPress credentials
  const { data: creds, error: credsErr } = await admin
    .from('integrations')
    .select('config, status')
    .eq('workspace_id', workspace.id)
    .eq('provider', 'wordpress')
    .single()

  if (credsErr || !creds || creds.status !== 'connected') {
    return jsonError('WordPress not connected. Go to Settings → Integrations to connect.', 400)
  }

  let config: { site_url: string; username: string; app_password: string }
  try {
    config = JSON.parse(await decrypt(creds.config.encrypted_config))
  } catch { return jsonError('WordPress credentials are corrupted — please reconnect', 400) }

  const { site_url, username, app_password } = config
  const auth = Buffer.from(`${username}:${app_password}`).toString('base64')

  // Defense in depth: site_url was validated when the connection was
  // saved (PUT above), but re-check here too — the stored value could in
  // principle be stale (DNS changed after saving) or, if this table were
  // ever written to by something other than the PUT handler, unvalidated.
  try {
    await assertSafeUrl(site_url)
  } catch (e) {
    return jsonError(
      e instanceof UnsafeUrlError
        ? `This workspace's WordPress site URL is no longer valid: ${e.message}`
        : 'WordPress site URL is invalid — please reconnect in Settings.',
      400,
    )
  }

  // ── Optional: Upload header image to WordPress media library ─────────────
  let featuredMediaId: number | null = null
  if (body.headerImageUrl) {
    try {
      await assertSafeUrl(body.headerImageUrl)
      const imgRes = await safeFetch(body.headerImageUrl, { signal: AbortSignal.timeout(15_000) })
      if (imgRes.ok) {
        const imgBuffer  = await imgRes.arrayBuffer()
        const imgType    = imgRes.headers.get('content-type') ?? 'image/png'
        const ext        = imgType.includes('jpeg') ? 'jpg' : 'png'
        const filename   = `${body.title.toLowerCase().replace(/\s+/g,'-').substring(0,50)}.${ext}`

        const mediaRes = await safeFetch(`${site_url}/wp-json/wp/v2/media`, {
          method:  'POST',
          headers: {
            'Authorization':       `Basic ${auth}`,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Type':        imgType,
          },
          body: imgBuffer,
          signal: AbortSignal.timeout(20_000),
        })
        if (mediaRes.ok) {
          const mediaData  = await mediaRes.json()
          featuredMediaId  = mediaData.id ?? null
        } else {
          console.warn('[wordpress/publish] Media upload failed:', mediaRes.status)
        }
      }
    } catch (err) {
      console.warn('[wordpress/publish] Header image upload failed:', (err as Error).message)
      // Non-fatal: proceed without featured image
    }
  }

  // ── Publish the post ──────────────────────────────────────────────────────
  const postBody: Record<string, unknown> = {
    title:   body.title,
    content: body.content,
    status:  body.status,
  }
  if (featuredMediaId) postBody.featured_media = featuredMediaId

  const wpRes = await safeFetch(`${site_url}/wp-json/wp/v2/posts`, {
    method:  'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(postBody),
    signal:  AbortSignal.timeout(15_000),
  })

  if (!wpRes.ok) {
    const errData = await wpRes.json().catch(() => ({}))
    console.error('[wordpress/publish] WP error:', wpRes.status, errData)
    if (wpRes.status === 401) return jsonError('WordPress authentication failed — check your Application Password', 401)
    if (wpRes.status === 403) return jsonError('WordPress user lacks permission to create posts', 403)
    return jsonError(errData.message ?? `WordPress returned ${wpRes.status}`, 500)
  }

  const post = await wpRes.json()

  // Update content piece with published URL + status
  if (body.contentId) {
    await admin.from('content_pieces').update({
      status:        'published',
      published_url: post.link ?? null,
    }).eq('id', body.contentId).eq('workspace_id', workspace.id)

    // Fire webhook
    dispatchWebhook(workspace.id, 'content.published', {
      content_id:     body.contentId,
      platform:       'wordpress',
      wordpress_id:   post.id,
      wordpress_link: post.link,
    })
  }

  return jsonOk({
    postId:          post.id,
    link:            post.link,
    status:          post.status,
    featuredMediaId: featuredMediaId ?? undefined,
  })
}
