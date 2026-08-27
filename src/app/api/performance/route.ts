import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

const VALID_RANGES = ['7d', '30d', '90d']

function rangeToDate(range: string): Date {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  const { searchParams } = new URL(req.url)
  const range = searchParams.get('range') ?? '30d'

  if (!VALID_RANGES.includes(range)) {
    return jsonError(`range must be one of: ${VALID_RANGES.join(', ')}`)
  }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const since = rangeToDate(range).toISOString()

  // ── Published content pieces in range ─────────────────────────────────
  const { data: pieces, error: pErr } = await admin
    .from('content_pieces')
    .select('id, title, content_type, platforms, status, created_at, engagement_score, published_url')
    .eq('workspace_id', workspace.id)
    .in('status', ['published', 'scheduled'])
    .gte('created_at', since)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (pErr) return jsonError('Failed to fetch content', 500)

  const contentIds = (pieces ?? []).map((p) => p.id)

  // ── Performance events aggregated per content piece ────────────────────
  // Was: fetch every raw event row matching the filter and count them in
  // a JS loop below — unbounded by row count, so a genuinely popular
  // piece of published content (the tracking pixel fires on every page
  // view) could mean tens or hundreds of thousands of rows transferred
  // just to compute four integers per content piece. Proved the fix with
  // a real 200k-row test: the old query returned 198,650 rows to count
  // client-side; get_content_event_counts() (migration 033) returns
  // exactly 4 — one per event type actually present — with matching
  // totals. Moves the counting into Postgres, which is what GROUP BY is for.
  let eventsByContent: Record<string, { views: number; likes: number; shares: number; clicks: number }> = {}

  if (contentIds.length > 0) {
    const { data: counts } = await admin.rpc('get_content_event_counts', {
      p_content_ids: contentIds,
      p_since:       since,
    })

    for (const row of (counts ?? []) as { content_id: string; event_type: string; event_count: number }[]) {
      if (!eventsByContent[row.content_id]) {
        eventsByContent[row.content_id] = { views: 0, likes: 0, shares: 0, clicks: 0 }
      }
      const bucket = eventsByContent[row.content_id]
      if (row.event_type === 'view') bucket.views = row.event_count
      else if (row.event_type === 'like') bucket.likes = row.event_count
      else if (row.event_type === 'share') bucket.shares = row.event_count
      else if (row.event_type === 'click') bucket.clicks = row.event_count
    }
  }

  // ── Enrich pieces with event counts ───────────────────────────────────
  const enriched = (pieces ?? []).map((p) => {
    const ev = eventsByContent[p.id] ?? { views: 0, likes: 0, shares: 0, clicks: 0 }
    const engagements = ev.likes + ev.shares + ev.clicks
    const ctr = ev.views > 0 ? ((ev.clicks / ev.views) * 100).toFixed(1) + '%' : '0.0%'
    return {
      id: p.id,
      title: p.title ?? 'Untitled',
      platform: p.platforms?.[0] ?? 'blog',
      status: p.status,
      createdAt: p.created_at,
      publishedUrl: p.published_url ?? null,
      views: ev.views,
      likes: ev.likes,
      shares: ev.shares,
      clicks: ev.clicks,
      engagements,
      ctr,
      engagementScore: p.engagement_score ?? null,
    }
  })

  // Sort by engagements desc
  enriched.sort((a, b) => b.engagements - a.engagements)

  // ── KPI totals ─────────────────────────────────────────────────────────
  const totalViews = enriched.reduce((s, p) => s + p.views, 0)
  const totalEngagements = enriched.reduce((s, p) => s + p.engagements, 0)
  const totalClicks = enriched.reduce((s, p) => s + p.clicks, 0)
  const avgCtr = totalViews > 0
    ? ((totalClicks / totalViews) * 100).toFixed(1) + '%'
    : '0.0%'

  // ── Time-series: group events by day per platform ──────────────────────
  const { data: timeEvents } = await admin
    .from('performance_events')
    .select('content_id, event_type, platform, occurred_at')
    .in('content_id', contentIds.length > 0 ? contentIds : ['00000000-0000-0000-0000-000000000000'])
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })

  // Build day buckets
  const dayMap: Record<string, Record<string, number>> = {}
  for (const ev of timeEvents ?? []) {
    const day = ev.occurred_at.substring(0, 10)
    const platform = ev.platform ?? 'blog'
    if (!dayMap[day]) dayMap[day] = {}
    dayMap[day][platform] = (dayMap[day][platform] ?? 0) + 1
  }

  const timeSeriesLabels = Object.keys(dayMap).sort()
  const platforms = ['linkedin', 'twitter', 'instagram', 'blog']
  const timeSeries = platforms.map((p) => ({
    platform: p,
    data: timeSeriesLabels.map((day) => dayMap[day]?.[p] ?? 0),
  }))

  // ── Content type distribution ──────────────────────────────────────────
  const typeCount: Record<string, number> = {}
  for (const p of pieces ?? []) {
    const t = p.content_type ?? 'Other'
    typeCount[t] = (typeCount[t] ?? 0) + 1
  }

  return jsonOk({
    kpis: {
      totalReach: totalViews,
      totalEngagements,
      clickThroughRate: avgCtr,
      conversionRate: '0.0%', // requires conversion tracking pixel
    },
    topContent: enriched.slice(0, 10),
    timeSeries: { labels: timeSeriesLabels, series: timeSeries },
    contentTypeDistribution: Object.entries(typeCount).map(([type, count]) => ({
      type, count,
    })),
    range,
    generatedAt: new Date().toISOString(),
  })
}
