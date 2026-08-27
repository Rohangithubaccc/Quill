import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

// ── GET /api/calendar?month=YYYY-MM ────────────────────────────────────────
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') // YYYY-MM

  const admin = createSupabaseAdmin()

  let query = admin
    .from('calendar_events')
    .select('id, title, platform, scheduled_at, status, content_id')
    .eq('workspace_id', workspace.id)
    .order('scheduled_at', { ascending: true })

  if (month) {
    const [year, mon] = month.split('-').map(Number)
    const start = new Date(year, mon - 1, 1).toISOString()
    const end = new Date(year, mon, 0, 23, 59, 59).toISOString()
    query = query.gte('scheduled_at', start).lte('scheduled_at', end)
  }

  const { data, error } = await query
  if (error) return dbError('calendar', error, 'Query failed. Please try again.', 500)

  return jsonOk({ events: data })
}

// ── POST /api/calendar — create event ─────────────────────────────────────
// Reasonable bounds on scheduledAt — found during a ruthless adversarial
// pass that z.string().datetime() validates ISO-8601 *format* only, with
// no sanity check on the actual date: year 1900 or year 9999 both passed.
// Wide on purpose (content calendars legitimately get planned months out,
// and rescheduling something from years back should still work) — this
// is a sanity net against bad client-side date math or bogus input, not
// a tight business-logic window.
const MIN_SCHEDULABLE_DATE = new Date('2000-01-01T00:00:00Z')
const MAX_SCHEDULABLE_DATE_YEARS_OUT = 10
function isReasonableScheduleDate(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const max = new Date()
  max.setFullYear(max.getFullYear() + MAX_SCHEDULABLE_DATE_YEARS_OUT)
  return d >= MIN_SCHEDULABLE_DATE && d <= max
}

const CreateSchema = z.object({
  title: z.string().min(1).max(300),
  platform: z.string().optional(),
  scheduledAt: z.string().datetime().refine(isReasonableScheduleDate, 'scheduledAt must be a realistic date'),
  contentId: z.string().uuid().optional(),
  status: z.enum(['draft', 'scheduled', 'published', 'cancelled']).default('scheduled'),
})

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  let body: z.infer<typeof CreateSchema>
  try { body = CreateSchema.parse(await req.json()) } catch (e) {
    return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body')
  }

  const admin = createSupabaseAdmin()
  const { data, error } = await admin
    .from('calendar_events')
    .insert({
      workspace_id: workspace.id,
      title: body.title,
      platform: body.platform ?? null,
      scheduled_at: body.scheduledAt,
      content_id: body.contentId ?? null,
      status: body.status,
    })
    .select()
    .single()

  if (error) return dbError('calendar', error, 'Create failed. Please try again.', 500)

  return jsonOk(data, 201)
}

// ── PATCH /api/calendar — update event (reschedule) ───────────────────────
const PatchSchema = z.object({
  id: z.string().uuid(),
  scheduledAt: z.string().datetime().refine(isReasonableScheduleDate, 'scheduledAt must be a realistic date').optional(),
  status: z.enum(['draft', 'scheduled', 'published', 'cancelled']).optional(),
  title: z.string().max(300).optional(),
})

export async function PATCH(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  let body: z.infer<typeof PatchSchema>
  try { body = PatchSchema.parse(await req.json()) } catch (e) {
    return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body')
  }

  const admin = createSupabaseAdmin()
  const update: Record<string, unknown> = {}
  if (body.scheduledAt) update.scheduled_at = body.scheduledAt
  if (body.status) update.status = body.status
  if (body.title) update.title = body.title

  const { error } = await admin
    .from('calendar_events')
    .update(update)
    .eq('id', body.id)
    .eq('workspace_id', workspace.id)

  if (error) return dbError('calendar', error, 'Update failed. Please try again.', 500)

  return jsonOk({ updated: true })
}

// ── DELETE /api/calendar ───────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { id } = await req.json() as { id: string }
  if (!id) return jsonError('Event ID required')

  const admin = createSupabaseAdmin()
  await admin
    .from('calendar_events')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id)

  return jsonOk({ deleted: true })
}
