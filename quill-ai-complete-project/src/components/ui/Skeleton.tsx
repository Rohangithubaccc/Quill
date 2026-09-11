'use client'

import React from 'react'

// ── Base shimmer style ─────────────────────────────────────────────────────
const shimmerStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, #1e1e28 25%, #252535 50%, #1e1e28 75%)',
  backgroundSize: '400px 100%',
  animation: 'quill-shimmer 1.4s infinite linear',
  borderRadius: '4px',
}

const shimmerKeyframes = `
  @keyframes quill-shimmer {
    0%   { background-position: -400px 0 }
    100% { background-position:  400px 0 }
  }
`

function ShimmerStyle() {
  return <style>{shimmerKeyframes}</style>
}

// ── SkeletonText — single line ─────────────────────────────────────────────
export function SkeletonText({
  width = '100%',
  height = 12,
  style,
}: {
  width?: string | number
  height?: number
  style?: React.CSSProperties
}) {
  return (
    <>
      <ShimmerStyle />
      <div style={{ ...shimmerStyle, width, height, borderRadius: '4px', ...style }} />
    </>
  )
}

// ── SkeletonParagraph — 3-4 lines of varying width ────────────────────────
export function SkeletonParagraph({ lines = 4 }: { lines?: number }) {
  const widths = ['80%', '100%', '75%', '60%', '90%', '85%']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <ShimmerStyle />
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          style={{ ...shimmerStyle, width: widths[i % widths.length], height: 12 }}
        />
      ))}
    </div>
  )
}

// ── SkeletonKpiCard — matches KPI card (~112px height) ────────────────────
export function SkeletonKpiCard() {
  return (
    <div style={{
      background: '#1e1e28', border: '1px solid #2a2a3a',
      borderRadius: '12px', padding: '20px', minHeight: '112px',
    }}>
      <ShimmerStyle />
      {/* Icon placeholder */}
      <div style={{ ...shimmerStyle, width: 28, height: 28, borderRadius: '50%', marginBottom: '12px' }} />
      {/* Value */}
      <div style={{ ...shimmerStyle, width: '50%', height: 28, marginBottom: '8px' }} />
      {/* Label */}
      <div style={{ ...shimmerStyle, width: '70%', height: 12, marginBottom: '6px' }} />
      {/* Delta */}
      <div style={{ ...shimmerStyle, width: '45%', height: 11 }} />
    </div>
  )
}

// ── SkeletonTableRow — matches table row (48px) ───────────────────────────
export function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  const colWidths = ['60%', '10%', '12%', '8%', '10%']
  return (
    <tr>
      <ShimmerStyle />
      {Array.from({ length: cols }).map((_, i) => (
        <td
          key={i}
          style={{ padding: '12px 16px', borderBottom: '1px solid rgba(42,42,58,0.5)' }}
        >
          <div style={{ ...shimmerStyle, width: colWidths[i] || '20%', height: 12 }} />
        </td>
      ))}
    </tr>
  )
}

// ── SkeletonContentCard — matches review queue card (~180px) ──────────────
export function SkeletonContentCard() {
  return (
    <div style={{
      background: '#1e1e28', border: '1px solid #2a2a3a',
      borderRadius: '12px', padding: '18px', minHeight: '180px',
    }}>
      <ShimmerStyle />
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ ...shimmerStyle, width: '65%', height: 16 }} />
        <div style={{ ...shimmerStyle, width: '14%', height: 22, borderRadius: '20px' }} />
      </div>
      {/* Second title line */}
      <div style={{ ...shimmerStyle, width: '45%', height: 14, marginBottom: '12px' }} />
      {/* Badge row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <div style={{ ...shimmerStyle, width: 72, height: 22, borderRadius: '20px' }} />
        <div style={{ ...shimmerStyle, width: 80, height: 22, borderRadius: '20px' }} />
        <div style={{ ...shimmerStyle, width: 60, height: 22, borderRadius: '20px' }} />
      </div>
      {/* Action buttons row */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {[90, 80, 74, 32].map((w, i) => (
          <div key={i} style={{ ...shimmerStyle, width: w, height: 28, borderRadius: '6px' }} />
        ))}
      </div>
    </div>
  )
}

// ── SkeletonTrendingItem — matches trending row (~56px) ───────────────────
export function SkeletonTrendingItem() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 12px', background: 'rgba(255,255,255,0.02)',
      borderRadius: '8px', border: '1px solid #2a2a3a',
    }}>
      <ShimmerStyle />
      {/* Rank */}
      <div style={{ ...shimmerStyle, width: 20, height: 20, flexShrink: 0 }} />
      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ ...shimmerStyle, width: '70%', height: 13 }} />
        <div style={{ ...shimmerStyle, width: '40%', height: 10 }} />
      </div>
      {/* Button */}
      <div style={{ ...shimmerStyle, width: 70, height: 24, borderRadius: '5px', flexShrink: 0 }} />
    </div>
  )
}

// ── SkeletonChartCard — chart area with title ─────────────────────────────
export function SkeletonChartCard({ height = 200 }: { height?: number }) {
  return (
    <div style={{
      background: '#1e1e28', border: '1px solid #2a2a3a',
      borderRadius: '12px', padding: '20px',
    }}>
      <ShimmerStyle />
      {/* Title */}
      <div style={{ ...shimmerStyle, width: '45%', height: 16, marginBottom: '16px' }} />
      {/* Chart area with subtle grid lines */}
      <div style={{
        position: 'relative', height,
        background: 'rgba(42,42,58,0.3)', borderRadius: '8px',
        overflow: 'hidden',
      }}>
        <div style={{ ...shimmerStyle, width: '100%', height: '100%', borderRadius: '8px' }} />
        {/* Fake grid lines */}
        {[25, 50, 75].map(pct => (
          <div key={pct} style={{
            position: 'absolute', left: 0, right: 0,
            top: `${pct}%`, height: '1px',
            background: 'rgba(42,42,58,0.6)',
          }} />
        ))}
      </div>
    </div>
  )
}

// ── SkeletonCalendarGrid — full calendar month ────────────────────────────
export function SkeletonCalendarGrid() {
  return (
    <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px', overflow: 'hidden' }}>
      <ShimmerStyle />
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid #2a2a3a' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ padding: '10px 4px', textAlign: 'center' }}>
            <div style={{ ...shimmerStyle, width: 28, height: 10, margin: '0 auto' }} />
          </div>
        ))}
      </div>
      {/* 5 rows × 7 cols */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} style={{
            minHeight: 90, padding: '8px',
            borderRight: '1px solid #2a2a3a',
            borderBottom: '1px solid #2a2a3a',
          }}>
            <div style={{ ...shimmerStyle, width: 22, height: 22, borderRadius: '50%', marginBottom: '6px' }} />
            {/* Random event pills */}
            {i % 5 === 0 && <div style={{ ...shimmerStyle, width: '85%', height: 16, borderRadius: '3px', marginBottom: '2px' }} />}
            {i % 7 === 2 && <div style={{ ...shimmerStyle, width: '70%', height: 16, borderRadius: '3px' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}
