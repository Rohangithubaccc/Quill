import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// ── Optimal posting time rules per platform ───────────────────────────────
// days: 0=Sun, 1=Mon, …, 6=Sat  |  hours: UTC hour of day
const OPTIMAL_SLOTS: Record<string, { days: number[]; hours: number[] }> = {
  linkedin:  { days: [1, 2, 3, 4],       hours: [8, 9, 10, 17, 18] },
  twitter:   { days: [0,1,2,3,4,5,6],    hours: [8, 9, 12, 17, 18, 19, 20] },
  instagram: { days: [1, 3, 5],          hours: [7, 11, 14, 19, 20, 21] },
  blog:      { days: [1, 2, 3],          hours: [8, 9, 10] },
  email:     { days: [2, 4],             hours: [9, 10] },
}

const BodySchema = z.object({
  contentIds: z.array(z.string().uuid()).min(1).max(50),
  platforms:  z.array(z.string()).default([]),
})

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  let body: z.infer<typeof BodySchema>
  try { body = BodySchema.parse(await req.json()) } catch (e) {
    return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body')
  }

  const admin = createSupabaseAdmin()

  // Fetch the actual content pieces to know their titles and platforms
  const { data: pieces, error: pErr } = await admin
    .from('content_pieces')
    .select('id, title, platforms, content_type')
    .in('id', body.contentIds)
    .eq('workspace_id', workspace.id)

  if (pErr || !pieces) return jsonError('Failed to fetch content', 500)

  // Skip anything that already has a calendar event rather than creating
  // a duplicate — the frontend's status=approved filter naturally avoids
  // this in normal usage (this endpoint itself transitions scheduled
  // content to status='scheduled', so a re-opened auto-schedule modal
  // won't re-offer it), but a direct API call, stale frontend state
  // mid-session, or a future UI change shouldn't be able to produce two
  // calendar rows for the same content piece.
  const { data: alreadyScheduled } = await admin
    .from('calendar_events')
    .select('content_id')
    .eq('workspace_id', workspace.id)
    .in('content_id', body.contentIds)

  const alreadyScheduledIds = new Set((alreadyScheduled ?? []).map(e => e.content_id))
  const piecesToSchedule    = pieces.filter(p => !alreadyScheduledIds.has(p.id))

  // Fetch existing calendar events for the next 30 days to avoid double-booking
  const now = new Date()
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const { data: existingEvents } = await admin
    .from('calendar_events')
    .select('platform, scheduled_at')
    .eq('workspace_id', workspace.id)
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', future.toISOString())

  // Build a set of already-booked "platform:YYYY-MM-DD:HH" slots
  const bookedSlots = new Set<string>()
  for (const ev of existingEvents ?? []) {
    const d = new Date(ev.scheduled_at)
    const key = `${ev.platform}:${d.toISOString().substring(0, 10)}:${String(d.getUTCHours()).padStart(2, '0')}`
    bookedSlots.add(key)
  }

  // ── Find next available slot for a given platform ──────────────────────
  function findNextSlot(platform: string, afterDate: Date): Date {
    const slots = OPTIMAL_SLOTS[platform] ?? OPTIMAL_SLOTS.blog
    const cursor = new Date(afterDate)
    cursor.setDate(cursor.getDate() + 1) // start from tomorrow

    for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
      const candidate = new Date(cursor)
      candidate.setDate(cursor.getDate() + dayOffset)
      const dow = candidate.getUTCDay()

      if (!slots.days.includes(dow)) continue

      for (const hour of slots.hours) {
        candidate.setUTCHours(hour, 0, 0, 0)
        const key = `${platform}:${candidate.toISOString().substring(0, 10)}:${String(hour).padStart(2, '0')}`
        if (!bookedSlots.has(key)) {
          bookedSlots.add(key) // claim this slot
          return new Date(candidate)
        }
      }
    }

    // Fallback: just use tomorrow at 9am if nothing found
    const fallback = new Date(now)
    fallback.setDate(fallback.getDate() + 1)
    fallback.setUTCHours(9, 0, 0, 0)
    return fallback
  }

  // ── Assign slots to content pieces ────────────────────────────────────
  const scheduled: {
    contentId: string; title: string; platform: string; scheduledAt: string
  }[] = []

  const insertRows: {
    workspace_id: string; content_id: string; title: string
    platform: string; scheduled_at: string; status: string
  }[] = []

  // Platform tracking for summary
  const platformCounts: Record<string, number> = {}
  let cursor = new Date(now)

  for (const piece of piecesToSchedule) {
    // Determine target platform: use first platform from piece, or from body, or default linkedin
    const rawPlatform =
      (piece.platforms as string[] | null)?.[0] ??
      (body.platforms[0]) ??
      'linkedin'
    const platform = rawPlatform.toLowerCase().replace(/[^a-z]/g, '')
    const normalised = OPTIMAL_SLOTS[platform] ? platform : 'linkedin'

    const slot = findNextSlot(normalised, cursor)
    cursor = slot // space subsequent pieces apart

    scheduled.push({
      contentId: piece.id,
      title: piece.title ?? 'Untitled',
      platform: normalised,
      scheduledAt: slot.toISOString(),
    })

    insertRows.push({
      workspace_id: workspace.id,
      content_id: piece.id,
      title: piece.title ?? 'Untitled',
      platform: normalised,
      scheduled_at: slot.toISOString(),
      status: 'scheduled',
    })

    platformCounts[normalised] = (platformCounts[normalised] ?? 0) + 1
  }

  // Bulk insert calendar events
  const { error: insertErr } = await admin.from('calendar_events').insert(insertRows)
  if (insertErr) return jsonError('Failed to create calendar events', 500)

  // Update content piece statuses to 'scheduled' — only the ones this
  // batch actually scheduled, not the full original request. Using
  // body.contentIds here would also touch pieces skipped above because
  // they already had a calendar event, which could regress an
  // already-published piece's status back to 'scheduled'.
  if (piecesToSchedule.length > 0) {
    await admin
      .from('content_pieces')
      .update({ status: 'scheduled' })
      .in('id', piecesToSchedule.map(p => p.id))
      .eq('workspace_id', workspace.id)
  }

  // Build human-readable summary
  const platformSummary = Object.entries(platformCounts)
    .map(([p, n]) => {
      const days = scheduled
        .filter(s => s.platform === p)
        .map(s => new Date(s.scheduledAt).toLocaleDateString('en-US', { weekday: 'short' }))
        .join('/')
      return `${n} ${p.charAt(0).toUpperCase() + p.slice(1)} (${days})`
    })
    .join(', ')

  const skippedCount = pieces.length - piecesToSchedule.length
  const skippedNote  = skippedCount > 0
    ? ` (${skippedCount} already scheduled — skipped)`
    : ''

  const summary = scheduled.length > 0
    ? `Scheduled ${scheduled.length} post${scheduled.length !== 1 ? 's' : ''}: ${platformSummary}${skippedNote}`
    : `Nothing to schedule — all ${skippedCount} selected piece${skippedCount !== 1 ? 's were' : ' was'} already scheduled.`

  return jsonOk({ scheduled, summary, count: scheduled.length, skipped: skippedCount })
}
