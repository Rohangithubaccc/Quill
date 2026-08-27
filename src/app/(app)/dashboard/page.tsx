'use client'

import { useEffect, useState, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import {
  SkeletonKpiCard, SkeletonTableRow, SkeletonTrendingItem,
} from '@/components/ui/Skeleton'

interface ContentPiece {
  id: string; title: string | null; platforms: string[] | null
  status: string; engagement_score: number | null; created_at: string
}
interface TrendTopic { tag: string; volume: number }
interface Workspace { id: string; name: string; plan: string; usage_count: number; usage_limit: number; credits_remaining: number; credits_monthly: number }

const STATUS_COLORS: Record<string, string> = {
  published: '#3ecf8e', scheduled: '#4fb3f7', review: '#f5c842',
  draft: '#7c7c9a', approved: '#6c63ff', rejected: '#f06565',
}
const PLATFORM_COLORS: Record<string, string> = {
  linkedin: '#3b82f6', twitter: '#4fb3f7', instagram: '#f472b6',
  blog: '#3ecf8e', email: '#f59e42',
}

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}
function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h/24)}d ago`
}

export default function DashboardPage() {
  const supabase = createSupabaseBrowserClient()
  const [content,   setContent]   = useState<ContentPiece[]>([])
  const [trends,    setTrends]    = useState<TrendTopic[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading,   setLoading]   = useState(true)
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInst = useRef<unknown>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Cast to any: this loose Database stub can't resolve Supabase's
    // nested-join type inference for aliased relations like
    // `workspace:workspaces(...)`. Real generated types would resolve
    // this correctly — see src/lib/types/database.ts for details.
    const { data: member } = await (supabase
      .from('workspace_members')
      .select('workspace:workspaces(id,name,plan,usage_count,usage_limit,credits_remaining,credits_monthly)')
      .eq('user_id', user.id).eq('status', 'active').limit(1).single() as any)

    const ws = member?.workspace as unknown as Workspace
    if (ws) {
      setWorkspace(ws)
      const { data: pieces } = await supabase
        .from('content_pieces')
        .select('id,title,platforms,status,engagement_score,created_at')
        .eq('workspace_id', ws.id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(7)
      setContent(pieces ?? [])
    }

    const res = await fetch('/api/analyzer/trends?platform=twitter&range=7d')
    if (res.ok) { const d = await res.json(); setTrends((d.hashtags ?? []).slice(0, 8)) }
    setLoading(false)
  }

  useEffect(() => {
    if (!chartRef.current || loading) return
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
    script.onload = () => {
      const Chart = (window as any).Chart
      if (!Chart) return
      if (chartInst.current) (chartInst.current as any).destroy()
      const labels = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i))
        return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
      })
      chartInst.current = new Chart(chartRef.current!.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Blog',     data: [2,3,2,4,3,5,4], borderColor: '#3ecf8e', backgroundColor: 'rgba(62,207,142,0.08)', tension: 0.4, fill: true, pointRadius: 3 },
            { label: 'LinkedIn', data: [1,2,3,2,4,3,5], borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.08)', tension: 0.4, fill: true, pointRadius: 3 },
            { label: 'Twitter',  data: [3,2,1,3,2,4,3], borderColor: '#4fb3f7', backgroundColor: 'rgba(79,179,247,0.06)', tension: 0.4, fill: true, pointRadius: 3 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#7c7c9a', font: { family: 'Inter', size: 11 }, boxWidth: 12 } } },
          scales: {
            x: { grid: { color: 'rgba(42,42,58,0.5)' }, ticks: { color: '#7c7c9a', font: { size: 10 } } },
            y: { grid: { color: 'rgba(42,42,58,0.5)' }, ticks: { color: '#7c7c9a', font: { size: 10 } }, beginAtZero: true },
          },
        },
      })
    }
    if (!document.querySelector('script[src*="chart.umd"]')) document.head.appendChild(script)
    else script.onload?.(new Event('load'))
  }, [loading])

  const creditsRemaining = workspace?.credits_remaining ?? 0
  const creditsMonthly   = workspace?.credits_monthly   ?? 1
  // creditUsedPct: how much of the monthly allocation has been consumed
  const usagePct = workspace
    ? Math.min(100, Math.round(((creditsMonthly - creditsRemaining) / creditsMonthly) * 100))
    : 0

  const kpis = [
    { icon: '⚡', value: workspace ? creditsRemaining.toLocaleString() : '—', label: 'Credits Remaining', delta: `of ${creditsMonthly.toLocaleString()} monthly`, up: creditsRemaining > creditsMonthly * 0.2 },
    { icon: '⚡', value: '8.4',                         label: 'Avg. Engagement Score', delta: '↑ 1.2 pts',        up: true },
    { icon: '🏆', value: 'LinkedIn',                    label: 'Top Platform',          delta: '↑ 34% reach',      up: true },
    { icon: '👀', value: content.filter(c => c.status==='review').length, label: 'Pending Review', delta: 'needs attention', up: false },
  ]

  return (
    <div style={{ padding: '24px', background: '#0f0f13', minHeight: '100%' }}>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '20px' }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonKpiCard key={i} />)
          : kpis.map((k, i) => (
            <div key={i} style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: '22px', marginBottom: '10px' }}>{k.icon}</div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '28px', fontWeight: 800, lineHeight: 1, marginBottom: '4px' }}>{String(k.value)}</div>
              <div style={{ fontSize: '12px', color: '#7c7c9a' }}>{k.label}</div>
              <div style={{ fontSize: '11px', fontWeight: 600, marginTop: '6px', color: k.up ? '#3ecf8e' : '#f06565' }}>{k.delta}</div>
            </div>
          ))}
      </div>

      {/* Usage warning */}
      {!loading && workspace && usagePct >= 80 && (
        <div style={{ background: 'linear-gradient(135deg,rgba(108,99,255,0.15),rgba(245,200,66,0.1))', border: '1px solid rgba(245,200,66,0.3)', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <span style={{ fontSize: '28px' }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#f5c842', fontSize: '14px' }}>Running low on credits — {creditsRemaining.toLocaleString()} remaining</div>
            <div style={{ fontSize: '12px', color: '#7c7c9a', marginTop: '2px' }}>{creditsRemaining.toLocaleString()} of {creditsMonthly.toLocaleString()} credits remaining on {workspace.plan} plan</div>
          </div>
          <Link href="/settings" style={{ background: '#f5c842', color: '#1a1a0a', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Upgrade →</Link>
        </div>
      )}

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px' }}>
        {/* Left */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700 }}>Recent Content</h2>
            <Link href="/generator" style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, color: '#e8e8f0', textDecoration: 'none' }}>+ New Content</Link>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #2a2a3a', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Title','Platform','Status','Eng. Score','Date'].map(h => (
                  <th key={h} style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7c7c9a', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid #2a2a3a', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} />)
                  : content.length === 0
                  ? <tr><td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#7c7c9a' }}>
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>✦</div>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, marginBottom: '4px' }}>No content yet</div>
                      <div style={{ fontSize: '12px' }}>Generate your first piece to see it here</div>
                    </td></tr>
                  : content.map(item => {
                    const platform = item.platforms?.[0] ?? 'blog'
                    const pc = PLATFORM_COLORS[platform] ?? '#7c7c9a'
                    const sc = item.engagement_score
                    return (
                      <tr key={item.id}>
                        <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500, borderBottom: '1px solid rgba(42,42,58,0.5)' }}>{item.title ?? 'Untitled'}</td>
                        <td style={{ padding: '12px 16px', borderBottom: '1px solid rgba(42,42,58,0.5)' }}>
                          <span style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', background: pc+'22', color: pc }}>{platform}</span>
                        </td>
                        <td style={{ padding: '12px 16px', borderBottom: '1px solid rgba(42,42,58,0.5)' }}>
                          <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: (STATUS_COLORS[item.status]??'#7c7c9a')+'22', color: STATUS_COLORS[item.status]??'#7c7c9a' }}>{item.status}</span>
                        </td>
                        <td style={{ padding: '12px 16px', borderBottom: '1px solid rgba(42,42,58,0.5)' }}>
                          {sc != null ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 600, color: sc > 8 ? '#3ecf8e' : sc > 7 ? '#f5c842' : '#7c7c9a' }}>{sc}</span>
                              <div style={{ width: 40, height: 4, background: '#2a2a3a', borderRadius: '99px', overflow: 'hidden' }}>
                                <div style={{ width: `${sc*10}%`, height: '100%', background: sc > 8 ? '#3ecf8e' : '#f5c842', borderRadius: '99px' }} />
                              </div>
                            </div>
                          ) : <span style={{ color: '#4a4a65' }}>—</span>}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '12px', color: '#7c7c9a', borderBottom: '1px solid rgba(42,42,58,0.5)' }}>{timeAgo(item.created_at)}</td>
                      </tr>
                    )
                  })
                }
              </tbody>
            </table>
          </div>

          {/* Chart */}
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px' }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '14px', fontWeight: 700, marginBottom: '16px' }}>Content Output — Last 7 Days</div>
            <div style={{ position: 'relative', height: '200px' }}>
              {loading ? (
                <div style={{ height: '100%', background: 'linear-gradient(90deg,#1e1e28 25%,#252535 50%,#1e1e28 75%)', backgroundSize: '400px 100%', animation: 'quill-shimmer 1.4s infinite', borderRadius: '8px' }} />
              ) : (
                <canvas ref={chartRef} />
              )}
            </div>
          </div>
        </div>

        {/* Right: trending */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700 }}>🔥 Trending</h2>
            <span style={{ fontSize: '11px', color: '#7c7c9a' }}>AI-curated</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonTrendingItem key={i} />)
              : trends.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px', color: '#7c7c9a', fontSize: '13px' }}>No trends loaded</div>
              : trends.map((t, i) => (
                <Link key={i} href="/generator" style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 12px', background: 'rgba(255,255,255,0.02)',
                  borderRadius: '8px', border: '1px solid #2a2a3a',
                  textDecoration: 'none', color: 'inherit', transition: 'border-color 0.15s',
                }}>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontSize: '18px', fontWeight: 800, color: '#4a4a65', width: '20px', flexShrink: 0 }}>{i+1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tag}</div>
                    <div style={{ fontSize: '10px', color: '#7c7c9a', marginTop: '1px' }}>{fmt(t.volume)} mentions</div>
                  </div>
                  <div style={{ padding: '4px 10px', background: 'rgba(108,99,255,0.15)', border: '1px solid #6c63ff', borderRadius: '5px', color: '#6c63ff', fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    Generate →
                  </div>
                </Link>
              ))
            }
          </div>
        </div>
      </div>
      <style>{`@keyframes quill-shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }`}</style>
    </div>
  )
}
