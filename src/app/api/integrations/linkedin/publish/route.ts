import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { decrypt, jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { dispatchWebhook }            from '@/lib/webhooks'

// POST /api/integrations/linkedin/publish
// Body: { contentId?: string; text: string; visibility?: 'PUBLIC' | 'CONNECTIONS' }
//
// Publishes a text post to LinkedIn using the UGC Posts API.
// Requires the w_member_social OAuth scope and a connected integration.
export async function POST(req: NextRequest) {

  // ── Auth ─────────────────────────────────────────────────────────────────
  let user: any
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  // ── Parse + validate body ─────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const { contentId, text, visibility = 'PUBLIC' } = body

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return jsonError('text is required')
  }
  // LinkedIn UGC Posts maximum commentary length is 3,000 characters
  if (text.length > 3000) {
    return jsonError('Text exceeds LinkedIn limit of 3,000 characters')
  }
  if (!['PUBLIC', 'CONNECTIONS'].includes(visibility)) {
    return jsonError('visibility must be PUBLIC or CONNECTIONS')
  }

  const admin = createSupabaseAdmin()

  // ── Fetch stored LinkedIn credentials ─────────────────────────────────────
  const { data: integration, error: intErr } = await admin
    .from('integrations')
    .select('config, status')
    .eq('workspace_id', workspace.id)
    .eq('provider', 'linkedin')
    .single()

  if (intErr || !integration || integration.status !== 'connected') {
    return jsonError('LinkedIn not connected — visit Settings → Integrations', 400)
  }

  // ── Decrypt credentials ───────────────────────────────────────────────────
  let creds: {
    access_token: string
    token_type:   string
    expires_at:   number
    profile_id:   string
    profile_name: string
  }
  try {
    creds = JSON.parse(await decrypt(integration.config.encrypted_config))
  } catch {
    return jsonError('linkedin_auth_expired', 401)
  }

  if (!creds.profile_id) {
    return jsonError('LinkedIn profile not found — please reconnect in Settings', 401)
  }

  // ── Token expiry check ────────────────────────────────────────────────────
  // LinkedIn tokens last 60 days and cannot be refreshed — user must reconnect.
  if (creds.expires_at && creds.expires_at < Date.now()) {
    return jsonError('linkedin_token_expired', 401)
  }

  // ── Construct UGC Post payload ────────────────────────────────────────────
  // The author URN identifies the LinkedIn member making the post.
  // Format: urn:li:person:{profileId}  where profileId = the OAuth 'sub' claim.
  const authorUrn = `urn:li:person:${creds.profile_id}`

  const postPayload = {
    author:         authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: text.trim(),
        },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': visibility,
    },
  }

  // ── Call LinkedIn UGC Posts API ───────────────────────────────────────────
  const liRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method:  'POST',
    headers: {
      'Authorization':               `Bearer ${creds.access_token}`,
      'Content-Type':                'application/json',
      'X-Restli-Protocol-Version':   '2.0.0',
    },
    body: JSON.stringify(postPayload),
  })

  if (!liRes.ok) {
    const errText = await liRes.text()
    console.error('[linkedin/publish] UGC Posts API failed:', liRes.status, errText)

    if (liRes.status === 401) {
      return jsonError('linkedin_auth_expired', 401)
    }
    if (liRes.status === 422) {
      // LinkedIn validation error — content likely violates their policies
      return jsonError('LinkedIn rejected the post — check content and try again', 422)
    }
    if (liRes.status === 429) {
      return jsonError('LinkedIn rate limit reached — try again in a few minutes', 429)
    }
    return jsonError('LinkedIn publish failed — please try again', 500)
  }

  const liData = await liRes.json()
  // liData.id = the URN of the created post, e.g. "urn:li:ugcPost:7012345678"
  const postUrn = liData.id ?? ''

  // ── Update content piece status ───────────────────────────────────────────
  if (contentId) {
    await admin
      .from('content_pieces')
      .update({ status: 'published' })
      .eq('id', contentId)
      .eq('workspace_id', workspace.id)
  }

  // Build a shareable post URL from the URN by extracting the numeric ID
  // URN format: urn:li:ugcPost:7012345678 → /feed/update/urn:li:ugcPost:7012345678/
  const postUrl = postUrn
    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`
    : null

  // Fire content.published webhook (non-blocking)
  if (body.contentId) {
    dispatchWebhook(workspace.id, 'content.published', {
      content_id: body.contentId,
      platform:   'linkedin',
    })
  }

  return jsonOk({
    postId:      postUrn,
    postUrl,
    publishedAt: new Date().toISOString(),
  })
}
