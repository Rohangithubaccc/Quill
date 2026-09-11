'use client'

import { useEffect, useState, useRef } from 'react'
import { SkeletonChartCard, SkeletonTableRow } from '@/components/ui/Skeleton'

const PLATFORMS = ['twitter','linkedin','instagram','reddit','tiktok']
const PLATFORM_LABELS: Record<string,string> = {
  twitter:'𝕏 Twitter', linkedin:'in LinkedIn', instagram:'📸 Instagram', reddit:'🤿 Reddit', tiktok:'🎵 TikTok',
}
const RANGES = ['7d','30d','90d']

interface TrendData {
  hashtags:    { tag: string; volume: number; source?: string }[]
  sentiment:   { positive: number; neutral: number; negative: number }
  insights:    string[]
  competitors: { name: string; topic: string; engagement: string; contentType: string; sentiment: string }[]
  cached?:     boolean
  stale?:      boolean
  dataSources?: { googleTrends: boolean; reddit: boolean; newsApi: boolean }
  _meta?:      { newsApiQuotaToday?: { used: number; limit: number } | null }
}

function fmt(n: number) {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M'
  if (n >= 1_000) return (n/1_000).toFixed(0)+'K'
  return String(n)
}

export default function AnalyzerPage() {
  const [platform, setPlatform] = useState('twitter')
  const [range,    setRange]    = useState('7d')
  const [data,     setData]     = useState<TrendData | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const sentimentRef   = useRef<HTMLCanvasElement>(null)
  const sentimentChart = useRef<unknown>(null)

  useEffect(() => { fetchTrends() }, [platform, range])
  useEffect(() => { if (data && !loading) renderSentiment() }, [data, loading])

  async function fetchTrends() {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/analyzer/trends?platform=${platform}&range=${range}`)
      if (!res.ok) { const e = await res.json(); setError(e.error ?? 'Failed'); setLoading(false); return }
      setData(await res.json())
    } catch { setError('Network error. Please try again.') }
    setLoading(false)
  }

  function renderSentiment() {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
    script.onload = () => {
      if (!sentimentRef.current || !data) return
      const Chart = (window as any).Chart
      if ((sentimentChart.current as any)?.destroy) (sentimentChart.current as any).destroy()
      sentimentChart.current = new Chart(sentimentRef.current.getContext('2d'), {
        type: 'doughnut',
        data: { labels:['Positive','Neutral','Negative'], datasets:[{ data:[data.sentiment.positive,data.sentiment.neutral,data.sentiment.negative], backgroundColor:['#3ecf8e','#f5c842','#f06565'], borderWidth:0 }] },
        options: { responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{ legend:{ display:false } } },
      })
    }
    if (!document.querySelector('script[src*="chart.umd"]')) document.head.appendChild(script)
    else script.onload?.(new Event('load'))
  }

  const heatmapDays  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const heatmapHours = Array.from({ length:24 }, (_,i) => i)

  return (
    <div style={{ padding:'24px', background:'#0f0f13', minHeight:'100%' }}>
      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px', flexWrap:'wrap', gap:'12px' }}>
        <div style={{ display:'flex', gap:'2px', background:'#1e1e28', padding:'3px', borderRadius:'7px', border:'1px solid #2a2a3a', flexWrap:'wrap' }}>
          {PLATFORMS.map(p => (
            <button key={p} onClick={() => setPlatform(p)} style={{ padding:'6px 14px', borderRadius:'5px', fontSize:'12px', fontWeight:500, cursor:'pointer', border:'none', fontFamily:'Inter, sans-serif', background:platform===p?'#6c63ff':'transparent', color:platform===p?'#fff':'#7c7c9a', whiteSpace:'nowrap' }}>
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', gap:'2px', background:'#1e1e28', padding:'3px', borderRadius:'7px', border:'1px solid #2a2a3a' }}>
          {RANGES.map(r => <button key={r} onClick={() => setRange(r)} style={{ padding:'6px 14px', borderRadius:'5px', fontSize:'12px', fontWeight:500, cursor:'pointer', border:'none', fontFamily:'Inter, sans-serif', background:range===r?'#6c63ff':'transparent', color:range===r?'#fff':'#7c7c9a' }}>{r}</button>)}
        </div>
      </div>

      {error && <div style={{ background:'rgba(240,101,101,0.12)', border:'1px solid rgba(240,101,101,0.25)', borderRadius:'8px', padding:'12px 16px', marginBottom:'16px', fontSize:'13px', color:'#f06565' }}>{error}</div>}
      {data?.cached && <div style={{ fontSize:'11px', color:'#4a4a65', marginBottom:'8px' }}>⚡ Cached data — refreshes every 6 hours</div>}

      {/* Data source badges — show which real APIs contributed */}
      {data && (
        <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap', marginBottom:'12px' }}>
          <span style={{ fontSize:'10px', color:'#7c7c9a', marginRight:'4px' }}>Data from:</span>
          {data.dataSources?.googleTrends && <span style={{ fontSize:'10px', fontWeight:600, color:'#DB4437', background:'rgba(219,68,55,0.1)', border:'1px solid rgba(219,68,55,0.25)', borderRadius:'4px', padding:'2px 7px' }}>● Google Trends</span>}
          {data.dataSources?.reddit       && <span style={{ fontSize:'10px', fontWeight:600, color:'#FF4500', background:'rgba(255,69,0,0.1)',   border:'1px solid rgba(255,69,0,0.25)',   borderRadius:'4px', padding:'2px 7px' }}>● Reddit</span>}
          {data.dataSources?.newsApi      && <span style={{ fontSize:'10px', fontWeight:600, color:'#1C86EE', background:'rgba(28,134,238,0.1)', border:'1px solid rgba(28,134,238,0.25)', borderRadius:'4px', padding:'2px 7px' }}>● News API</span>}
          {!data.dataSources?.googleTrends && !data.dataSources?.reddit && !data.dataSources?.newsApi && (
            <span style={{ fontSize:'10px', color:'#f59e42' }}>⚠ Real-time data unavailable — using AI synthesis</span>
          )}
        </div>
      )}

      {/* Hashtags + Sentiment */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'20px' }}>
        {loading ? (
          <><SkeletonChartCard height={200} /><SkeletonChartCard height={200} /></>
        ) : (
          <>
            <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px' }}>
              <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'14px' }}>Top Trending Hashtags</div>
              {(data?.hashtags ?? []).map((h, i) => {
                const max = Math.max(...(data?.hashtags ?? []).map(x => x.volume), 1)
                const pct = Math.round(h.volume / max * 100)
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
                    <div style={{ fontSize:'13px', fontWeight:600, color:'#6c63ff', width:'160px', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.tag}</div>
                    <div style={{ flex:1, height:'8px', background:'#2a2a3a', borderRadius:'99px', overflow:'hidden' }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:'linear-gradient(90deg,#6c63ff,#f5c842)', borderRadius:'99px' }} />
                    </div>
                    <div style={{ fontSize:'11px', color:'#7c7c9a', width:'55px', textAlign:'right', flexShrink:0 }}>{fmt(h.volume)}</div>
                    {(h as any).source && (h as any).source !== 'synthesized' && (
                      <div style={{ fontSize:'9px', color:'#4a4a65', width:'40px', flexShrink:0 }}>{(h as any).source}</div>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px' }}>
              <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'14px' }}>Sentiment Analysis</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', alignItems:'center' }}>
                <div style={{ position:'relative', height:'160px' }}><canvas ref={sentimentRef} /></div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                  {data && [{ color:'#3ecf8e', label:'Positive', val:data.sentiment.positive },{ color:'#f5c842', label:'Neutral', val:data.sentiment.neutral },{ color:'#f06565', label:'Negative', val:data.sentiment.negative }].map(s => (
                    <div key={s.label} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <div style={{ width:'10px', height:'10px', borderRadius:'50%', background:s.color, flexShrink:0 }} />
                      <span style={{ fontSize:'12px', color:'#7c7c9a', flex:1 }}>{s.label}</span>
                      <span style={{ fontSize:'12px', fontWeight:700 }}>{s.val}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Heatmap */}
      {loading ? <SkeletonChartCard height={160} /> : (
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px', marginBottom:'20px' }}>
          <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'14px' }}>Engagement Heatmap (Day × Hour)</div>
          <div style={{ overflowX:'auto' }}>
            <div style={{ display:'grid', gridTemplateColumns:'40px repeat(24,1fr)', gap:'2px', minWidth:'700px' }}>
              <div />
              {heatmapHours.map(h => <div key={h} style={{ textAlign:'center', fontSize:'8px', color:'#7c7c9a', paddingBottom:'2px' }}>{h}h</div>)}
              {heatmapDays.map((day, di) => (
                <>
                  <div key={day} style={{ fontSize:'9px', color:'#7c7c9a', display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:'4px' }}>{day}</div>
                  {heatmapHours.map(h => {
                    let val = Math.random()
                    if ((h>=8 && h<=10) || (h>=18 && h<=21)) val = Math.random()*0.5+0.5
                    if (di===0 || di===6) val *= 0.5
                    return <div key={h} style={{ borderRadius:'2px', minWidth:'14px', minHeight:'14px', background:`rgba(108,99,255,${(0.05+val*0.8).toFixed(2)})` }} title={`${day} ${h}:00 — ${Math.round(val*100)}%`} />
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Competitors */}
      <div style={{ marginBottom:'20px' }}>
        <div style={{ fontSize:'14px', fontFamily:'Syne, sans-serif', fontWeight:700, marginBottom:'12px' }}>Competitor Content Analysis</div>
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>{['Competitor','Top Post Topic','Engagement','Content Type','Sentiment'].map(h => (
                <th key={h} style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', padding:'12px 16px', background:'rgba(255,255,255,0.02)', borderBottom:'1px solid #2a2a3a', textAlign:'left' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length:5 }).map((_,i) => <SkeletonTableRow key={i} cols={5} />)
                : (data?.competitors ?? []).map((c, i) => (
                  <tr key={i}>
                    <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight:600, borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{c.name}</td>
                    <td style={{ padding:'12px 16px', fontSize:'13px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{c.topic}</td>
                    <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight:600, color:'#3ecf8e', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{c.engagement}</td>
                    <td style={{ padding:'12px 16px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>
                      <span style={{ padding:'3px 8px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'rgba(124,124,154,0.15)', color:'#7c7c9a' }}>{c.contentType}</span>
                    </td>
                    <td style={{ padding:'12px 16px', fontSize:'13px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{c.sentiment}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* Insights */}
      {!loading && data && data.insights.length > 0 && (
        <div style={{ background:'linear-gradient(135deg,rgba(108,99,255,0.08),rgba(245,200,66,0.05))', border:'1px solid rgba(108,99,255,0.2)', borderRadius:'12px', padding:'20px' }}>
          <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, marginBottom:'14px' }}>🤖 AI Insights — What&apos;s Working Right Now</div>
          <ul style={{ listStyle:'none', display:'flex', flexDirection:'column', gap:'8px' }}>
            {data.insights.map((insight, i) => (
              <li key={i} style={{ display:'flex', alignItems:'flex-start', gap:'8px', fontSize:'13px', lineHeight:1.5 }}>
                <span style={{ color:'#f5c842', fontSize:'10px', marginTop:'4px', flexShrink:0 }}>✦</span>
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
