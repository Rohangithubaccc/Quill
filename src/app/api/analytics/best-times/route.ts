import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// 3-hour windows rather than per-hour buckets — per-hour gives 168
// buckets (24 × 7), which fragments a typical workspace's publish
// history too thinly to find a real pattern. 8 windows × 7 days = 56
// buckets, enough to actually accumulate more than 1 sample per bucket
// at realistic posting volumes.
const WINDOWS = [
  { label: '12am–3am',  start: 0,  end: 3  },
  { label: '3am–6am',   start: 3,  end: 6  },
  { label: '6am–9am',   start: 6,  end: 9  },
  { label: '9am–12pm',  start: 9,  end: 12 },
  { label: '12pm–3pm',  start: 12, end: 15 },
  { label: '3pm–6pm',   start: 15, end: 18 },
  { label: '6pm–9pm',   start: 18, end: 21 },
  { label: '9pm–12am',  start: 21, end: 24 },
]

function windowForHour(hour: number) {
  return WINDOWS.find(w => hour >= w.start && hour < w.end) ?? WINDOWS[0]
}

// Generic, non-personalized guidance shown when a workspace doesn't yet
// have enough publish history for a real recommendation — stated as
// general practice, not dressed up as personalized analysis.
const FALLBACK_GUIDANCE = [
  { day: 'Tuesday',   window: '9am–12pm', note: 'General B2B best practice — not yet personalized for this workspace.' },
  { day: 'Wednesday', window: '9am–12pm', note: 'General B2B best practice — not yet personalized for this workspace.' },
  { day: 'Thursday',  window: '12pm–3pm', note: 'General B2B best practice — not yet personalized for this workspace.' },
]

const MIN_TOTAL_SAMPLES  = 5   // below this, don't attempt personalization at all
const MIN_BUCKET_SAMPLES = 2   // a bucket with only 1 data point is noise, not a pattern

export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()

  // Join calendar_events -> content_pieces manually (Supabase's embedded-
  // resource syntax works for this, but the aggregation itself still has
  // to happen in JS either way — see the campaigns rollup for the same
  // pattern already used elsewhere in this codebase).
  const { data: events, error } = await admin
    .from('calendar_events')
    .select('scheduled_at, platform, content_pieces!inner(engagement_score, status, workspace_id)')
    .eq('content_pieces.workspace_id', workspace.id)
    .eq('content_pieces.status', 'published')
    .not('content_pieces.engagement_score', 'is', null)

  if (error) return dbError('analytics/best-times', error, 'Query failed. Please try again.', 500)

  const rows = (events ?? []) as unknown as {
    scheduled_at: string
    platform: string | null
    content_pieces: { engagement_score: number; status: string }
  }[]

  if (rows.length < MIN_TOTAL_SAMPLES) {
    return jsonOk({
      personalized: false,
      sampleSize:   rows.length,
      recommendations: FALLBACK_GUIDANCE,
      message: `Based on general content-marketing practice, not this workspace's data yet — only ${rows.length} published, scheduled piece${rows.length === 1 ? '' : 's'} so far. This becomes personalized once there are at least ${MIN_TOTAL_SAMPLES}.`,
    })
  }

  const buckets = new Map<string, { day: string; window: string; platform: string; sum: number; count: number }>()

  for (const row of rows) {
    const dt = new Date(row.scheduled_at)
    const day = DAY_NAMES[dt.getUTCDay()]
    const win = windowForHour(dt.getUTCHours())
    const platform = row.platform ?? 'blog'
    const key = `${day}|${win.label}|${platform}`

    const b = buckets.get(key) ?? { day, window: win.label, platform, sum: 0, count: 0 }
    b.sum += Number(row.content_pieces.engagement_score)
    b.count += 1
    buckets.set(key, b)
  }

  const ranked = Array.from(buckets.values())
    .filter(b => b.count >= MIN_BUCKET_SAMPLES)
    .map(b => ({ day: b.day, window: b.window, platform: b.platform, avgEngagement: Math.round((b.sum / b.count) * 100) / 100, sampleSize: b.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, 5)

  if (ranked.length === 0) {
    return jsonOk({
      personalized: false,
      sampleSize:   rows.length,
      recommendations: FALLBACK_GUIDANCE,
      message: `${rows.length} published pieces so far, but no single day/time combination has ${MIN_BUCKET_SAMPLES}+ posts yet to compare — showing general guidance until patterns emerge.`,
    })
  }

  return jsonOk({
    personalized: true,
    sampleSize:   rows.length,
    recommendations: ranked,
    message: `Based on ${rows.length} published pieces from this workspace's own history.`,
  })
}
