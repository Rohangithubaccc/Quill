import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireUser, requireWorkspace, createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { bufferFetch, BufferAuthError } from '@/lib/buffer'

// POST /api/integrations/buffer/publish
//
// Publishes or schedules content to one or more Buffer profiles.
// Unlike the legacy POST in the callback route, this endpoint:
//   • Uses bufferFetch() which handles token refresh automatically
//   • Returns a structured { updateId, shareUrl, status } response
//   • Distinguishes buffer_auth_expired errors so the UI can surface
//     a reconnect prompt rather than a generic "failed" message

const PublishSchema = z.object({
  // ID of the content piece to update status on after publishing
  contentId:   z.string().uuid().optional(),
  // Buffer profile IDs to publish to (at least one required)
  profileIds:  z.array(z.string().min(1)).min(1, 'At least one profile required'),
  // The text content to publish
  text:        z.string().min(1).max(2000),
  // ISO 8601 datetime — if provided the post is scheduled; otherwise queued
  scheduledAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  // ── Workspace ──────────────────────────────────────────────────────────
  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) { return workspaceCatch(e) }

  // ── Validate body ──────────────────────────────────────────────────────
  let body: z.infer<typeof PublishSchema>
  try {
    body = PublishSchema.parse(await req.json())
  } catch (e) {
    return jsonError(
      e instanceof z.ZodError ? e.errors[0].message : 'Invalid request body'
    )
  }

  const admin = createSupabaseAdmin()

  // ── Publish to each Buffer profile ────────────────────────────────────
  // Buffer's updates/create endpoint accepts one profile at a time
  // (profile_ids[] is an array but behaves per-profile for scheduling).
  // We iterate and collect results to give granular feedback per profile.
  const results: {
    profileId: string
    updateId?:  string
    shareUrl?:  string
    status:     string
    error?:     string
  }[] = []

  for (const profileId of body.profileIds) {
    const formBody = new URLSearchParams()
    formBody.append('profile_ids[]', profileId)
    formBody.append('text', body.text)

    if (body.scheduledAt) {
      // Schedule for a specific time
      formBody.append('scheduled_at', body.scheduledAt)
    }
    // If scheduledAt is omitted, Buffer adds the post to the profile's queue

    try {
      const res = await bufferFetch(
        workspace.id,
        '/1/updates/create.json',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    formBody,
        }
      )

      const data = await res.json() as {
        updates?: { id: string; profile_id: string; status: string; service_update_id?: string }[]
        success?: boolean
      }

      const update = data.updates?.[0]
      results.push({
        profileId,
        updateId: update?.id,
        shareUrl: undefined,  // Buffer doesn't return the share URL synchronously
        status:   body.scheduledAt ? 'scheduled' : 'queued',
      })

    } catch (err) {
      if (err instanceof BufferAuthError) {
        // Surface auth errors immediately — no point continuing with other profiles
        return new Response(
          JSON.stringify({
            error:   'buffer_auth_expired',
            message: err.message,
          }),
          {
            status:  401,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Non-auth error — record the failure and continue to next profile
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[Buffer publish] Profile ${profileId} failed:`, message)
      results.push({ profileId, status: 'error', error: message })
    }

    // Buffer rate limit: 60 req/min — courtesy delay when posting to
    // multiple profiles in a single request.
    if (body.profileIds.length > 1) {
      await new Promise((r) => setTimeout(r, 1050))
    }
  }

  // ── Update content piece status ────────────────────────────────────────
  // Only update if at least one profile succeeded.
  const anySuccess = results.some((r) => r.status !== 'error')

  if (body.contentId && anySuccess) {
    const newStatus = body.scheduledAt ? 'scheduled' : 'queued'
    // Supabase's query builder is a "thenable", not a real Promise, so it
    // has no .catch(). Wrap with Promise.resolve() to get a real one.
    await Promise.resolve(
      admin
        .from('content_pieces')
        .update({ status: newStatus })
        .eq('id', body.contentId)
    ).catch((err) => console.error('[Buffer publish] Failed to update content status:', err))
  }

  // ── Response ───────────────────────────────────────────────────────────
  const successCount = results.filter((r) => r.status !== 'error').length

  // Surface the first result's fields at the top level for convenience
  // when publishing to a single profile (the common case).
  const first = results[0]

  return jsonOk({
    updateId:  first?.updateId,
    shareUrl:  first?.shareUrl,
    status:    first?.status ?? 'error',
    scheduled: successCount,
    total:     body.profileIds.length,
    results,
  })
}
