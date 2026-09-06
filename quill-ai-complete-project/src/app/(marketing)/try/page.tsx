'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

const INDUSTRIES    = ['Tech & SaaS', 'Healthcare', 'Finance', 'E-commerce', 'Legal', 'Real Estate', 'Other']
const CONTENT_TYPES = ['Blog Post', 'LinkedIn Article', 'Twitter Thread', 'Instagram Caption']
const TONES         = ['Professional', 'Conversational', 'Authoritative', 'Witty', 'Empathetic']

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a',
  borderRadius: '8px', padding: '9px 12px', color: '#e8e8f0',
  fontSize: '13px', fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box',
}
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'none' as const, cursor: 'pointer' }
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7c7c9a', marginBottom: '6px',
}

// Stall detection thresholds for the public demo.
// Shorter than the app (60 s abort vs 2 min) because demos are capped at
// ~800 tokens and should complete in well under 30 s on a healthy connection.
const DEMO_STALL_WARN_MS  = 20_000  // show soft warning after 20 s of silence
const DEMO_STALL_ABORT_MS = 60_000  // abort hard after 60 s of silence
const DEMO_STALL_CHECK_MS = 5_000   // poll every 5 s

export default function TryPage() {
  const [industry,     setIndustry]     = useState('Tech & SaaS')
  const [contentType,  setContentType]  = useState('Blog Post')
  const [tone,         setTone]         = useState('Professional')
  const [keyword,      setKeyword]      = useState('')
  const [wordCount,    setWordCount]    = useState(400)
  const [output,       setOutput]       = useState('')
  const [wordCountOut, setWordCountOut] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDone,       setIsDone]       = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const [alreadyUsed,  setAlreadyUsed]  = useState(false)
  const [stallMsg,     setStallMsg]     = useState('')

  const outputRef    = useRef<HTMLDivElement>(null)
  const abortRef     = useRef<AbortController | null>(null)
  const stallCheckId = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('quill_demo_used')) {
      setAlreadyUsed(true)
    }
  }, [])

  // Clear stall interval on unmount to prevent state updates after navigation
  useEffect(() => {
    return () => { if (stallCheckId.current) clearInterval(stallCheckId.current) }
  }, [])

  function clearStallCheck() {
    if (stallCheckId.current) { clearInterval(stallCheckId.current); stallCheckId.current = null }
    setStallMsg('')
  }

  async function generate() {
    if (isGenerating) return

    setIsGenerating(true)
    setOutput('')
    setWordCountOut(0)
    setIsDone(false)
    setLimitReached(false)
    clearStallCheck()

    abortRef.current = new AbortController()
    let fullText   = ''
    let lastChunkAt = Date.now()

    // ── Stall detector ─────────────────────────────────────────────────────
    // Polls every 5 s. At 20 s of silence shows a soft banner. At 60 s
    // aborts and re-enables the Generate button so the user can retry.
    //
    // The session-used flag is deliberately NOT set on stall/abort — a user
    // whose demo timed out due to server load should not be permanently blocked.
    stallCheckId.current = setInterval(() => {
      const elapsed = Date.now() - lastChunkAt

      if (elapsed >= DEMO_STALL_ABORT_MS) {
        clearStallCheck()
        abortRef.current?.abort()
        setOutput('Generation timed out. Please try again.')
        setIsGenerating(false)
        return
      }

      if (elapsed >= DEMO_STALL_WARN_MS) {
        setStallMsg('Taking longer than usual…')
      }
    }, DEMO_STALL_CHECK_MS)

    try {
      const res = await fetch('/api/demo/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ industry, contentType, tone, keyword, wordCount }),
        signal:  abortRef.current.signal,
      })

      if (res.status === 429) {
        clearStallCheck()
        setLimitReached(true)
        setIsGenerating(false)
        // Rate limit = intentional 1/day cap — set the session flag
        if (typeof window !== 'undefined') sessionStorage.setItem('quill_demo_used', '1')
        setAlreadyUsed(true)
        return
      }

      if (!res.ok) {
        clearStallCheck()
        setOutput('Generation failed. Please try again.')
        setIsGenerating(false)
        return
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'text') {
              // Reset stall timer on every received chunk
              lastChunkAt = Date.now()
              setStallMsg('')
              fullText += ev.text
              setOutput(fullText)
              if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
            } else if (ev.type === 'done') {
              // Only mark as used on successful completion —
              // not on timeout or network error
              setWordCountOut(ev.wordCount)
              setIsDone(true)
              if (typeof window !== 'undefined') sessionStorage.setItem('quill_demo_used', '1')
              setAlreadyUsed(true)
            } else if (ev.type === 'error') {
              // Server emitted an explicit error (e.g. server-side timeout)
              clearStallCheck()
              setOutput(ev.error ?? 'Generation failed. Please try again.')
              setIsGenerating(false)
              return
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // Network error — do NOT set session flag; user should be able to retry
        setOutput('Connection error. Please try again.')
      }
      // AbortError: either the 60 s stall already set the message, or
      // the user navigated away — no additional message needed.
    }

    clearStallCheck()
    setIsGenerating(false)
  }

  return (
    <>
      <style>{`
        @keyframes sparkle {
          0%,100% { opacity: 0.3; transform: scale(0.8) }
          50%      { opacity: 1;   transform: scale(1.2) }
        }
        @keyframes shimmer {
          0%   { transform: translateX(-100%) }
          100% { transform: translateX(300%) }
        }
        @keyframes blink {
          0%,100% { opacity: 1 }
          50%      { opacity: 0 }
        }
        @media (max-width: 768px) {
          .try-grid { flex-direction: column !important; }
          .try-col  { width: 100% !important; max-width: 100% !important; }
        }
      `}</style>

      <div style={{ background: '#0f0f13', minHeight: '100vh', padding: '40px 24px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 14px', borderRadius: '99px', border: '1px solid rgba(108,99,255,0.3)', background: 'rgba(108,99,255,0.08)', marginBottom: '16px' }}>
              <span style={{ color: '#6c63ff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em' }}>✦ LIVE DEMO</span>
            </div>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '36px', color: '#e8e8f0', marginBottom: '8px', lineHeight: 1.2 }}>
              Try Quill.AI for free
            </h1>
            <p style={{ fontSize: '16px', color: '#7c7c9a', marginBottom: '12px' }}>
              Fill the brief below and watch AI generate publish-ready content in seconds.
            </p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#4a4a65' }}>
              <span style={{ color: '#3ecf8e' }}>●</span>
              1 free generation per day · No signup required
            </div>
          </div>

          {/* Already used — show signup CTA */}
          {alreadyUsed && !isDone && !isGenerating && (
            <div style={{ background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.3)', borderRadius: '16px', padding: '32px', textAlign: 'center', marginBottom: '32px' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🎉</div>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px', marginBottom: '8px' }}>You&apos;ve already tried the demo!</h2>
              <p style={{ fontSize: '14px', color: '#7c7c9a', marginBottom: '20px', lineHeight: 1.6 }}>
                Create a free account to get a full 14-day trial — generate up to 12 complete pieces with no credit card required.
              </p>
              <Link href="/signup" style={{ display: 'inline-block', background: '#6c63ff', color: '#fff', textDecoration: 'none', borderRadius: '10px', padding: '13px 32px', fontSize: '16px', fontWeight: 700 }}>
                Create Free Account →
              </Link>
            </div>
          )}

          {/* Rate limited */}
          {limitReached && (
            <div style={{ background: 'rgba(245,200,66,0.1)', border: '1px solid rgba(245,200,66,0.3)', borderRadius: '12px', padding: '20px', textAlign: 'center', marginBottom: '24px' }}>
              <p style={{ fontSize: '14px', color: '#f5c842', marginBottom: '12px', fontWeight: 600 }}>
                You&apos;ve already tried the demo today! Create a free account to get 14 days of unlimited access.
              </p>
              <Link href="/signup" style={{ display: 'inline-block', background: '#f5c842', color: '#1a1a0a', textDecoration: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '14px', fontWeight: 700 }}>
                Start Free Trial →
              </Link>
            </div>
          )}

          {/* Main grid */}
          <div className="try-grid" style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

            {/* LEFT — Brief form */}
            <div className="try-col" style={{ width: '360px', flexShrink: 0 }}>
              <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px', padding: '24px' }}>
                <h3 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '15px', marginBottom: '20px', color: '#e8e8f0' }}>✦ Content Brief</h3>

                {[
                  { label: 'Industry',     value: industry,    set: setIndustry,    opts: INDUSTRIES },
                  { label: 'Content Type', value: contentType, set: setContentType, opts: CONTENT_TYPES },
                  { label: 'Tone',         value: tone,        set: setTone,        opts: TONES },
                ].map(f => (
                  <div key={f.label} style={{ marginBottom: '14px' }}>
                    <label style={labelStyle}>{f.label}</label>
                    <select value={f.value} onChange={e => f.set(e.target.value)} style={selectStyle}
                      onFocus={e => (e.target.style.borderColor = '#6c63ff')} onBlur={e => (e.target.style.borderColor = '#2a2a3a')}>
                      {f.opts.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}

                <div style={{ marginBottom: '14px' }}>
                  <label style={labelStyle}>Primary Keyword</label>
                  <input value={keyword} onChange={e => setKeyword(e.target.value)}
                    placeholder="e.g. developer productivity" style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = '#6c63ff')} onBlur={e => (e.target.style.borderColor = '#2a2a3a')} />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>Word Count</label>
                  <input type="range" min={100} max={600} value={wordCount}
                    onChange={e => setWordCount(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#6c63ff' }} />
                  <div style={{ textAlign: 'right', fontSize: '12px', color: '#6c63ff', fontWeight: 600, marginTop: '4px' }}>{wordCount} words</div>
                </div>

                <button onClick={generate} disabled={isGenerating || (alreadyUsed && !isGenerating && !isDone)}
                  style={{
                    width: '100%', background: '#6c63ff', color: '#fff',
                    border: 'none', borderRadius: '10px', padding: '13px',
                    fontSize: '15px', fontWeight: 700,
                    cursor: (isGenerating || (alreadyUsed && !isDone)) ? 'not-allowed' : 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    opacity: (isGenerating || (alreadyUsed && !isDone && !isGenerating)) ? 0.7 : 1,
                    transition: 'all 0.18s',
                  }}>
                  {isGenerating ? '⏳ Generating…' : alreadyUsed && !isDone ? 'Already generated today' : '✦ Try It Free'}
                </button>

                {(alreadyUsed && !isDone) && (
                  <Link href="/signup" style={{ display: 'block', textAlign: 'center', marginTop: '10px', fontSize: '13px', color: '#6c63ff', textDecoration: 'none', fontWeight: 600 }}>
                    Sign up to generate more →
                  </Link>
                )}
              </div>
            </div>

            {/* RIGHT — Output */}
            <div className="try-col" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px', overflow: 'hidden', minHeight: '500px', display: 'flex', flexDirection: 'column' }}>

                {/* Tab bar */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a3a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ background: '#6c63ff', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: '#fff' }}>Draft</div>
                  <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#4a4a65' }}>
                    {wordCountOut > 0 ? `${wordCountOut} words` : ''}
                  </div>
                </div>

                {/* Stall warning banner — only visible when stream goes quiet */}
                {stallMsg && (
                  <div style={{
                    background: 'rgba(245,158,66,0.10)', borderBottom: '1px solid rgba(245,158,66,0.2)',
                    padding: '8px 16px', fontSize: '12px', color: '#f59e42',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    <span style={{ animation: 'blink 1s infinite', display: 'inline-block' }}>⏳</span>
                    {stallMsg}
                  </div>
                )}

                {/* Output body */}
                <div ref={outputRef} style={{ flex: 1, padding: '20px', overflowY: 'auto', position: 'relative' }}>

                  {/* Empty state */}
                  {!output && !isGenerating && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '360px', textAlign: 'center' }}>
                      <div style={{ position: 'relative', marginBottom: '20px' }}>
                        {[0, 1, 2, 3].map(i => (
                          <span key={i} style={{
                            position: 'absolute', fontSize: '20px',
                            top:  `${Math.sin(i * 1.57) * 30}px`,
                            left: `${Math.cos(i * 1.57) * 30}px`,
                            animation: `sparkle 1.5s ${i * 0.3}s ease infinite`,
                          }}>✦</span>
                        ))}
                        <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(108,99,255,0.12)', border: '1px solid rgba(108,99,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', position: 'relative', zIndex: 1, margin: '0 auto' }}>✦</div>
                      </div>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Your AI content will appear here</div>
                      <div style={{ fontSize: '13px', color: '#7c7c9a' }}>Takes about 10 seconds · No signup required</div>
                    </div>
                  )}

                  {/* Shimmer loading skeleton */}
                  {isGenerating && !output && (
                    <div>
                      {[80, 95, 70, 88, 60].map((w, i) => (
                        <div key={i} style={{ height: '14px', background: '#2a2a3a', borderRadius: '4px', marginBottom: '10px', width: `${w}%`, overflow: 'hidden', position: 'relative' }}>
                          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(108,99,255,0.3), transparent)', animation: `shimmer 1.4s ${i * 0.15}s linear infinite` }} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Streamed output */}
                  {output && (
                    <div style={{ fontSize: '14px', lineHeight: 1.75, color: '#e8e8f0', whiteSpace: 'pre-wrap' }}>
                      {output}
                      {isGenerating && <span style={{ display: 'inline-block', width: '2px', height: '14px', background: '#6c63ff', marginLeft: '1px', animation: 'blink 0.8s infinite', verticalAlign: 'middle' }} />}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky post-generation CTA — only shown on successful done event */}
      {isDone && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 900,
          background: 'linear-gradient(135deg, #16161d, #1e1e28)',
          borderTop: '1px solid rgba(108,99,255,0.4)',
          padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '12px',
          boxShadow: '0 -8px 32px rgba(108,99,255,0.2)',
        }}>
          <div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '15px', color: '#e8e8f0' }}>
              🎉 You generated {wordCountOut} words of content for free!
            </div>
            <div style={{ fontSize: '13px', color: '#7c7c9a', marginTop: '2px' }}>
              Sign up to save this and generate 11 more pieces free — no credit card needed.
            </div>
          </div>
          <Link href="/signup" style={{
            background: '#6c63ff', color: '#fff', textDecoration: 'none',
            borderRadius: '10px', padding: '12px 28px', fontSize: '15px',
            fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
            boxShadow: '0 4px 20px rgba(108,99,255,0.4)',
          }}>
            Create Free Account →
          </Link>
        </div>
      )}
    </>
  )
}
