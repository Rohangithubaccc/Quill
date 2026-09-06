'use client'

import EmptyState from '@/components/ui/EmptyState'
import { useEffect, useState, useRef, useCallback } from 'react'
import { SkeletonKpiCard, SkeletonChartCard, SkeletonTableRow } from '@/components/ui/Skeleton'

interface PerfData {
  kpis: { totalReach:number; totalEngagements:number; clickThroughRate:string; conversionRate:string }
  topContent: { id:string; title:string; platform:string; views:number; likes:number; shares:number; ctr:string; status:string; publishedUrl:string|null }[]
  timeSeries: { labels:string[]; series:{platform:string;data:number[]}[] }
  contentTypeDistribution: {type:string;count:number}[]
}

// ── GSC (Google Search Console) types ───────────────────────────────────────
interface GscRow {
  keyword:     string
  clicks:      number
  impressions: number
  ctr:         number
  position:    number
}

interface GscResult {
  pageUrl:   string
  siteUrl:   string
  startDate: string
  endDate:   string
  rows:      GscRow[]
  totalRows: number
}

const PLATFORM_COLORS: Record<string,string> = {
  linkedin:'#3b82f6', twitter:'#4fb3f7', instagram:'#f472b6', blog:'#3ecf8e',
}
const RANGE_OPTIONS = ['7d','30d','90d'] as const
type Range = typeof RANGE_OPTIONS[number]

function fmt(n: number) {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M'
  if (n >= 1_000)     return (n/1_000).toFixed(1)+'K'
  return String(n)
}

// ─────────────────────────────────────────────────────────────────────────────
// GSC Rankings Panel (per content piece)
// ─────────────────────────────────────────────────────────────────────────────

function GscPanel({
  piece,
  gscResult,
  loading,
  onLoad,
}: {
  piece:      PerfData['topContent'][number]
  gscResult:  GscResult | null
  loading:    boolean
  onLoad:     (url: string) => void
}) {
  const [manualUrl, setManualUrl] = useState('')
  const [showInput, setShowInput] = useState(false)

  const hasPubUrl = !!piece.publishedUrl
  const hasData   = !!gscResult && gscResult.rows.length > 0
  const hasNoData = !!gscResult && gscResult.rows.length === 0

  function triggerLoad() {
    const url = hasPubUrl ? piece.publishedUrl! : manualUrl.trim()
    if (!url) return
    onLoad(url)
  }

  return (
    <div style={{ marginBottom:'8px', background:'#1a1a28', border:'1px solid #2a2a3a', borderRadius:'10px', padding:'14px 16px' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', marginBottom: hasData ? '12px' : 0 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:'13px', fontWeight:600, color:'#e8e8f0', marginBottom:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {piece.title || 'Untitled'}
          </div>
          {hasData && (
            <div style={{ fontSize:'11px', color:'#7c7c9a' }}>
              Top keyword:{' '}
              <span style={{ color:'#a8a3ff', fontStyle:'italic' }}>&ldquo;{gscResult!.rows[0].keyword}&rdquo;</span>
              {' — '}<span>#{gscResult!.rows[0].position} position</span>
              {' · '}<span>{gscResult!.rows[0].impressions.toLocaleString()} impressions</span>
              {' · '}<span style={{ color:'#3ecf8e' }}>{gscResult!.rows[0].clicks} clicks</span>
            </div>
          )}
          {hasNoData && (
            <div style={{ fontSize:'11px', color:'#7c7c9a' }}>No search data found for this URL in the last 28 days.</div>
          )}
        </div>

        <div style={{ flexShrink:0, display:'flex', gap:'6px', alignItems:'center' }}>
          {!hasPubUrl && !showInput && !gscResult && (
            <button onClick={() => setShowInput(true)}
              style={{ fontSize:'11px', color:'#7c7c9a', background:'transparent', border:'1px solid #2a2a3a', borderRadius:'6px', padding:'4px 10px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}>
              Enter URL
            </button>
          )}
          {(hasPubUrl || showInput) && !gscResult && (
            <button onClick={triggerLoad} disabled={loading || (!hasPubUrl && !manualUrl.trim())}
              style={{ fontSize:'11px', color:'#6c63ff', background:'transparent', border:'1px solid rgba(108,99,255,0.3)', borderRadius:'6px', padding:'4px 10px', cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'Inter, sans-serif', opacity: loading ? 0.6 : 1 }}>
              {loading ? '⏳' : '📊 Load rankings'}
            </button>
          )}
          {gscResult && (
            <button onClick={triggerLoad} disabled={loading} title="Refresh"
              style={{ fontSize:'11px', color:'#7c7c9a', background:'transparent', border:'1px solid #2a2a3a', borderRadius:'6px', padding:'4px 8px', cursor:'pointer', fontFamily:'Inter, sans-serif', opacity: loading ? 0.5 : 1 }}>
              {loading ? '⏳' : '↺'}
            </button>
          )}
        </div>
      </div>

      {showInput && !hasPubUrl && !gscResult && (
        <div style={{ display:'flex', gap:'8px', marginBottom: hasData ? '12px' : '0', marginTop:'8px' }}>
          <input type="url" value={manualUrl} onChange={e => setManualUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') triggerLoad() }}
            placeholder="https://yourblog.com/post-slug"
            style={{ flex:1, background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'6px', padding:'6px 10px', color:'#e8e8f0', fontSize:'12px', fontFamily:'Inter, sans-serif', outline:'none' }}
            onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')} />
          <button onClick={triggerLoad} disabled={loading || !manualUrl.trim()}
            style={{ background:'#6c63ff', color:'#fff', border:'none', borderRadius:'6px', padding:'6px 12px', fontSize:'12px', fontWeight:600, cursor: loading || !manualUrl.trim() ? 'not-allowed' : 'pointer', fontFamily:'Inter, sans-serif' }}>
            Go
          </button>
        </div>
      )}

      {hasData && (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 56px 90px 60px 70px', gap:'8px', fontSize:'10px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#4a4a6a', padding:'4px 8px', marginBottom:'4px' }}>
            <span>Keyword</span>
            <span style={{ textAlign:'right' }}>Rank</span>
            <span style={{ textAlign:'right' }}>Impressions</span>
            <span style={{ textAlign:'right' }}>Clicks</span>
            <span style={{ textAlign:'right' }}>CTR</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
            {gscResult!.rows.slice(0, 5).map((row, i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 56px 90px 60px 70px', gap:'8px', fontSize:'12px', padding:'7px 8px', background:'#0f0f17', borderRadius:'6px' }}>
                <span style={{ color:'#e8e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={row.keyword}>{row.keyword}</span>
                <span style={{ color: row.position <= 10 ? '#3ecf8e' : row.position <= 20 ? '#f59e42' : '#7c7c9a', textAlign:'right', fontWeight:600 }}>#{row.position}</span>
                <span style={{ color:'#9898b8', textAlign:'right' }}>{row.impressions.toLocaleString()}</span>
                <span style={{ color:'#3ecf8e', textAlign:'right', fontWeight:600 }}>{row.clicks}</span>
                <span style={{ color:'#7c7c9a', textAlign:'right' }}>{row.ctr}%</span>
              </div>
            ))}
          </div>
          {gscResult!.totalRows > 5 && (
            <div style={{ fontSize:'11px', color:'#4a4a6a', textAlign:'center', marginTop:'8px' }}>
              Showing 5 of {gscResult!.totalRows} keywords
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PerformancePage() {
  const [range,   setRange]   = useState<Range>('30d')
  const [data,    setData]    = useState<PerfData|null>(null)
  const [loading, setLoading] = useState(true)
  const [roiCost, setRoiCost] = useState(899)
  const [roiPer,  setRoiPer]  = useState(320)
  const lineRef = useRef<HTMLCanvasElement>(null)
  const pieRef  = useRef<HTMLCanvasElement>(null)
  const barRef  = useRef<HTMLCanvasElement>(null)
  const charts  = useRef<unknown[]>([])

  // ── GSC (Google Search Console) state — keyed by content piece id ────────
  const [gscData,      setGscData]      = useState<Record<string, GscResult>>({})
  const [gscLoading,   setGscLoading]   = useState<Record<string, boolean>>({})
  const [gscError,     setGscError]     = useState<Record<string, string>>({})
  const [gscConnected, setGscConnected] = useState<boolean | null>(null)
  const [gscToast,     setGscToast]     = useState<{msg:string;type:'success'|'error'}|null>(null)

  // ── Best posting times (AI intelligence layer) ────────────────────────
  interface BestTimesData {
    personalized: boolean; sampleSize: number; message: string
    recommendations: { day: string; window: string; platform?: string; avgEngagement?: number; sampleSize?: number; note?: string }[]
  }
  const [bestTimes, setBestTimes] = useState<BestTimesData | null>(null)

  useEffect(() => {
    fetch('/api/analytics/best-times').then(r => r.ok ? r.json() : null).then(d => { if (d) setBestTimes(d) })
  }, [])

  useEffect(() => { fetchData() }, [range])
  useEffect(() => { if (!loading && data) renderCharts() }, [loading, data])

  // Check whether GSC is connected, so we know whether to show a "Connect" CTA
  useEffect(() => {
    fetch('/api/integrations')
      .then(r => r.json())
      .then((integrations: { provider: string; status: string }[]) => {
        const gsc = integrations.find(i => i.provider === 'gsc')
        setGscConnected(gsc?.status === 'connected')
      })
      .catch(() => setGscConnected(false))
  }, [])

  async function loadGscData(contentId: string, publishedUrl: string) {
    setGscLoading(prev => ({ ...prev, [contentId]: true }))
    setGscError(prev => { const n = { ...prev }; delete n[contentId]; return n })
    try {
      const res = await fetch(`/api/integrations/gsc/data?url=${encodeURIComponent(publishedUrl)}&days=28`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        const msg = d.error ?? `HTTP ${res.status}`
        setGscError(prev => ({
          ...prev,
          [contentId]: (msg === 'gsc_auth_expired' || res.status === 401)
            ? 'GSC token expired — reconnect in Settings → Integrations.'
            : msg,
        }))
        setGscToast({ msg, type:'error' }); setTimeout(() => setGscToast(null), 4000)
        return
      }
      const result: GscResult = await res.json()
      setGscData(prev => ({ ...prev, [contentId]: result }))
    } catch (err: any) {
      const msg = err.message ?? 'Failed to load GSC data'
      setGscError(prev => ({ ...prev, [contentId]: msg }))
      setGscToast({ msg, type:'error' }); setTimeout(() => setGscToast(null), 4000)
    } finally {
      setGscLoading(prev => ({ ...prev, [contentId]: false }))
    }
  }

  async function fetchData() {
    setLoading(true)
    const res = await fetch(`/api/performance?range=${range}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }

  function renderCharts() {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
    script.onload = () => {
      const Chart = (window as any).Chart; if (!Chart||!data) return
      charts.current.forEach((c:any) => c?.destroy()); charts.current = []
      const base = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#7c7c9a', font:{family:'Inter',size:11}, boxWidth:12 } } }, scales:{ x:{ grid:{color:'rgba(42,42,58,0.5)'}, ticks:{color:'#7c7c9a',font:{size:10}} }, y:{ grid:{color:'rgba(42,42,58,0.5)'}, ticks:{color:'#7c7c9a',font:{size:10}}, beginAtZero:true } } }

      // Only render the line chart when there is real series data.
      // When series is empty we show an EmptyState in JSX — skip Chart.js init.
      if (lineRef.current && data.timeSeries.series.length > 0) {
        const labels   = data.timeSeries.labels
        const datasets = data.timeSeries.series.map(s => ({
          label:           s.platform.charAt(0).toUpperCase()+s.platform.slice(1),
          data:            s.data,
          borderColor:     PLATFORM_COLORS[s.platform]??'#6c63ff',
          backgroundColor: (PLATFORM_COLORS[s.platform]??'#6c63ff')+'15',
          tension:         0.4,
          fill:            true,
          pointRadius:     3,
        }))
        charts.current.push(new Chart(lineRef.current.getContext('2d'), { type:'line', data:{labels,datasets}, options:base }))
      }

      // Only render the doughnut when there is real distribution data.
      // When empty we show an EmptyState in JSX — skip Chart.js init.
      if (pieRef.current && data.contentTypeDistribution.length > 0) {
        const dist = data.contentTypeDistribution
        charts.current.push(new Chart(pieRef.current.getContext('2d'), { type:'doughnut', data:{ labels:dist.map(d=>d.type), datasets:[{ data:dist.map(d=>d.count), backgroundColor:['#3ecf8e','#3b82f6','#4fb3f7','#f472b6','#f59e42'], borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:false, cutout:'60%', plugins:{ legend:{ position:'right', labels:{color:'#7c7c9a',font:{family:'Inter',size:10},boxWidth:10} } } } }))
      }

      if (barRef.current && data.topContent.length>0) {
        const top = data.topContent.slice(0,10)
        charts.current.push(new Chart(barRef.current.getContext('2d'), { type:'bar', data:{ labels:top.map(c=>c.title.substring(0,25)+(c.title.length>25?'…':'')), datasets:[{ label:'Engagements', data:top.map(c=>c.likes+c.shares), backgroundColor:top.map(c=>PLATFORM_COLORS[c.platform]??'#6c63ff'), borderRadius:4 }] }, options:{ ...base, indexAxis:'y', plugins:{ legend:{display:false} } } }))
      }
    }
    if (!document.querySelector('script[src*="chart.umd"]')) document.head.appendChild(script)
    else script.onload?.(new Event('load'))
  }

  const pieces  = data?.topContent.length ?? 0
  const totalVal = pieces * roiPer
  const roi      = roiCost > 0 ? Math.round((totalVal-roiCost)/roiCost*100) : 0

  const thStyle: React.CSSProperties = { fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', padding:'12px 16px', background:'rgba(255,255,255,0.02)', borderBottom:'1px solid #2a2a3a', textAlign:'left' }

  // ── Empty state for the line chart (shown when no real series data) ──────
  const LineChartEmpty = (
    <div style={{
      height:'220px', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      background:'rgba(30,30,40,0.4)', borderRadius:'8px',
      border:'1px dashed rgba(42,42,58,0.8)',
    }}>
      <div style={{ fontSize:'32px', opacity:0.35, marginBottom:'10px' }}>📊</div>
      <div style={{ fontFamily:'Syne, sans-serif', fontSize:'15px', fontWeight:700, color:'#e8e8f0' }}>
        No engagement data yet
      </div>
      <div style={{ fontSize:'12px', color:'#7c7c9a', marginTop:'6px', maxWidth:'300px', textAlign:'center', lineHeight:1.55 }}>
        Publish content and install the tracking pixel to see real engagement charts.
      </div>
      <div style={{ fontSize:'12px', color:'#4a4a65', marginTop:'4px', maxWidth:'300px', textAlign:'center', lineHeight:1.55 }}>
        Connect your platforms in Settings → Integrations to start collecting data.
      </div>
    </div>
  )

  // ── Empty state for the doughnut chart (shown when no distribution data) ─
  const PieChartEmpty = (
    <div style={{
      height:'220px', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      background:'rgba(30,30,40,0.4)', borderRadius:'8px',
      border:'1px dashed rgba(42,42,58,0.8)',
    }}>
      <div style={{ fontSize:'24px', opacity:0.3 }}>📊</div>
      <div style={{ fontSize:'12px', color:'#7c7c9a', marginTop:'6px' }}>No content published yet</div>
    </div>
  )

  const hasLineSeries = (data?.timeSeries.series.length ?? 0) > 0
  const hasPieDist    = (data?.contentTypeDistribution.length ?? 0) > 0

  // Pieces eligible for GSC search-ranking lookup: published, and either a
  // blog platform or an already-known published URL.
  const publishedPieces = (data?.topContent ?? []).filter(p =>
    p.status === 'published' && (p.platform?.toLowerCase().includes('blog') || p.publishedUrl)
  )

  return (
    <div style={{ padding:'24px', background:'#0f0f13', minHeight:'100%' }}>
      {gscToast && (
        <div style={{ position:'fixed', bottom:'88px', right:'20px', zIndex:9999, background:'#16161d', border:'1px solid #2a2a3a', borderLeft:`3px solid ${gscToast.type==='success'?'#3ecf8e':'#f06565'}`, borderRadius:'10px', padding:'12px 16px', fontSize:'13px', fontWeight:500, boxShadow:'0 4px 20px rgba(0,0,0,0.4)', maxWidth:'280px' }}>
          {gscToast.msg}
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
        <div style={{ display:'flex', gap:'2px', background:'#1e1e28', padding:'3px', borderRadius:'7px', border:'1px solid #2a2a3a' }}>
          {RANGE_OPTIONS.map(r => <button key={r} onClick={()=>setRange(r)} style={{ padding:'6px 14px', borderRadius:'5px', fontSize:'12px', fontWeight:500, cursor:'pointer', border:'none', fontFamily:'Inter, sans-serif', background:range===r?'#6c63ff':'transparent', color:range===r?'#fff':'#7c7c9a' }}>{r}</button>)}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'16px', marginBottom:'20px' }}>
        {loading ? Array.from({length:4}).map((_,i)=><SkeletonKpiCard key={i}/>) : ([
          { icon:'👁️', value:fmt(data?.kpis.totalReach??0),         label:'Total Reach',       delta:'from published content',  up:true  },
          { icon:'❤️', value:fmt(data?.kpis.totalEngagements??0),  label:'Total Engagements', delta:'likes + shares + clicks',  up:true  },
          { icon:'🖱️', value:data?.kpis.clickThroughRate??'0%',   label:'Click-Through Rate', delta:'across all platforms',     up:true  },
          { icon:'💰', value:data?.kpis.conversionRate??'0%',      label:'Conversion Rate',   delta:'add tracking pixel',       up:false },
        ].map((k,i) => (
          <div key={i} style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px' }}>
            <div style={{ fontSize:'22px', marginBottom:'10px' }}>{k.icon}</div>
            <div style={{ fontFamily:'Syne, sans-serif', fontSize:'28px', fontWeight:800, lineHeight:1, marginBottom:'4px' }}>{k.value}</div>
            <div style={{ fontSize:'12px', color:'#7c7c9a' }}>{k.label}</div>
            <div style={{ fontSize:'11px', fontWeight:600, marginTop:'6px', color:k.up?'#3ecf8e':'#7c7c9a' }}>{k.delta}</div>
          </div>
        )))}
      </div>

      {/* Charts */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'20px' }}>
        {loading ? (
          <><SkeletonChartCard height={220}/><SkeletonChartCard height={220}/></>
        ) : (
          <>
            <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px' }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, marginBottom:'16px' }}>Engagement Over Time</div>
              <div style={{ position:'relative', height:'220px' }}>
                {/* Render the real chart canvas only when there is actual series data.
                    When empty, show the EmptyState — no hardcoded fallback numbers. */}
                {hasLineSeries
                  ? <canvas ref={lineRef} style={{ width:'100%', height:'100%' }}/>
                  : LineChartEmpty
                }
              </div>
            </div>
            <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px' }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, marginBottom:'16px' }}>Content Type Distribution</div>
              <div style={{ position:'relative', height:'220px' }}>
                {/* Render the real doughnut canvas only when distribution data exists.
                    When empty, show the EmptyState — no hardcoded fallback counts. */}
                {hasPieDist
                  ? <canvas ref={pieRef} style={{ width:'100%', height:'100%' }}/>
                  : PieChartEmpty
                }
              </div>
            </div>
          </>
        )}
      </div>

      {loading ? <SkeletonChartCard height={220}/> : (
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px', marginBottom:'20px' }}>
          <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, marginBottom:'16px' }}>Top Content by Engagement</div>
          <div style={{ position:'relative', height:'220px' }}><canvas ref={barRef}/></div>
        </div>
      )}

      {/* ROI */}
      <div style={{ background:'linear-gradient(135deg,rgba(108,99,255,0.08),rgba(245,200,66,0.05))', border:'1px solid rgba(108,99,255,0.2)', borderRadius:'12px', padding:'20px', marginBottom:'20px' }}>
        <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, marginBottom:'16px' }}>💰 ROI Estimator</div>
        <div style={{ display:'flex', gap:'20px', flexWrap:'wrap', marginBottom:'16px' }}>
          {[{ label:'Monthly Plan Cost ($)', val:roiCost, set:setRoiCost },{ label:'Avg. Value per Content Piece ($)', val:roiPer, set:setRoiPer }].map(f => (
            <div key={f.label}>
              <label style={{ display:'block', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'6px' }}>{f.label}</label>
              <input type="number" value={f.val} onChange={e=>f.set(Number(e.target.value))} style={{ width:'140px', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'8px 12px', color:'#e8e8f0', fontSize:'14px', fontFamily:'Inter, sans-serif', outline:'none' }} />
            </div>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px' }}>
          {[
            { value:`$${totalVal.toLocaleString()}`,              label:'Total Content Value', color:'#f5c842' },
            { value:`${roi}%`,                                    label:'Estimated ROI',       color:'#3ecf8e' },
            { value:`$${(pieces*263).toLocaleString()}`,          label:'Agency Cost Saved',   color:'#4fb3f7' },
            { value:`$${(totalVal-roiCost).toLocaleString()}`,    label:'Net Value Generated', color:'#6c63ff' },
          ].map(m => (
            <div key={m.label} style={{ background:'#1e1e28', borderRadius:'8px', padding:'14px', textAlign:'center', border:'1px solid #2a2a3a' }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontSize:'22px', fontWeight:800, color:m.color }}>{m.value}</div>
              <div style={{ fontSize:'11px', color:'#7c7c9a', marginTop:'4px' }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── GSC Search Rankings ─────────────────────────────────────────── */}
      {!loading && publishedPieces.length > 0 && (
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px', marginBottom:'20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px', flexWrap:'wrap', gap:'10px' }}>
            <div>
              <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700 }}>🔍 Search Rankings</div>
              <div style={{ fontSize:'12px', color:'#7c7c9a', marginTop:'2px' }}>Google Search Console data for published blog posts · last 28 days</div>
            </div>
            {gscConnected === false && (
              <a href="/settings?tab=integrations" style={{ fontSize:'12px', color:'#6c63ff', fontWeight:600, textDecoration:'none', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.25)', borderRadius:'6px', padding:'5px 12px' }}>
                Connect GSC →
              </a>
            )}
          </div>

          {gscConnected === false ? (
            <div style={{ background:'#0f0f13', border:'1px dashed #2a2a3a', borderRadius:'10px', padding:'24px', textAlign:'center' }}>
              <div style={{ fontSize:'28px', marginBottom:'10px' }}>🔍</div>
              <p style={{ fontSize:'13px', color:'#7c7c9a', margin:'0 0 14px', lineHeight:1.6 }}>
                Connect Google Search Console to see which keywords your published posts rank for.
              </p>
              <a href="/settings?tab=integrations" style={{ display:'inline-block', background:'#6c63ff', color:'#fff', borderRadius:'8px', padding:'9px 20px', fontSize:'13px', fontWeight:600, textDecoration:'none' }}>
                Connect Google Search Console
              </a>
            </div>
          ) : (
            <div>
              {publishedPieces.map(piece => (
                <GscPanel
                  key={piece.id}
                  piece={piece}
                  gscResult={gscData[piece.id] ?? null}
                  loading={!!gscLoading[piece.id]}
                  onLoad={url => loadGscData(piece.id, url)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Best Times to Post (AI intelligence layer) ────────────────── */}
      {bestTimes && (
        <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>🔮 Best Times to Post</div>
          <div style={{ fontSize: '12px', color: '#7c7c9a', marginBottom: '14px' }}>
            {bestTimes.message}
            {!bestTimes.personalized && (
              <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, color: '#f5c842', background: 'rgba(245,200,66,0.12)', borderRadius: '20px', padding: '2px 8px', letterSpacing: '0.04em' }}>
                GENERAL GUIDANCE
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            {bestTimes.recommendations.map((r, i) => (
              <div key={i} style={{ background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700 }}>{r.day}, {r.window}</div>
                {r.platform && <div style={{ fontSize: '11px', color: '#7c7c9a', marginTop: '2px', textTransform: 'capitalize' }}>{r.platform}</div>}
                {r.avgEngagement !== undefined ? (
                  <div style={{ fontSize: '12px', color: '#3ecf8e', marginTop: '6px', fontWeight: 600 }}>
                    Avg. engagement: {r.avgEngagement} <span style={{ color: '#7c7c9a', fontWeight: 400 }}>({r.sampleSize} posts)</span>
                  </div>
                ) : r.note ? (
                  <div style={{ fontSize: '11px', color: '#7c7c9a', marginTop: '6px' }}>{r.note}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>{['Title','Platform','Views','Likes','Shares','CTR','Status'].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? Array.from({length:5}).map((_,i)=><SkeletonTableRow key={i} cols={7}/>) :
             (data?.topContent.length??0)===0 ? (
              <tr><td colSpan={7}><EmptyState icon="📈" title="No performance data yet" body="Publish your first piece of content to start tracking reach, engagement, and CTR across platforms." cta={{ label: 'Generate & Publish', href: '/generator' }} /></td></tr>
            ) : data!.topContent.map(row => {
              const pc = PLATFORM_COLORS[row.platform]??'#6c63ff'
              return (
                <tr key={row.id}>
                  <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight:500, borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{row.title}</td>
                  <td style={{ padding:'12px 16px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}><span style={{ padding:'2px 7px', borderRadius:'4px', fontSize:'10px', fontWeight:700, textTransform:'uppercase', background:pc+'22', color:pc }}>{row.platform}</span></td>
                  <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight:600, borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{fmt(row.views)}</td>
                  <td style={{ padding:'12px 16px', fontSize:'13px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{fmt(row.likes)}</td>
                  <td style={{ padding:'12px 16px', fontSize:'13px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{fmt(row.shares)}</td>
                  <td style={{ padding:'12px 16px', fontSize:'13px', color:'#3ecf8e', fontWeight:600, borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{row.ctr}</td>
                  <td style={{ padding:'12px 16px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}><span style={{ padding:'3px 8px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'rgba(62,207,142,0.15)', color:'#3ecf8e' }}>{row.status}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
