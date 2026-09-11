'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import EmptyState from '@/components/ui/EmptyState'
import { SkeletonContentCard } from '@/components/ui/Skeleton'

interface CampaignSummary {
  id:            string
  name:          string
  description:   string | null
  goal:          string | null
  status:        string
  start_date:    string | null
  end_date:      string | null
  created_at:    string
  pieceCount:    number
  statusCounts:  Record<string, number>
  avgEngagement: number | null
  platforms:     string[]
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Draft',     color: '#7c7c9a', bg: 'rgba(124,124,154,0.12)' },
  active:    { label: 'Active',    color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)'  },
  completed: { label: 'Completed', color: '#6c63ff', bg: 'rgba(108,99,255,0.12)'  },
  archived:  { label: 'Archived',  color: '#4a4a65', bg: 'rgba(74,74,101,0.12)'   },
}

const FILTER_TABS = ['All', 'Draft', 'Active', 'Completed', 'Archived']

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('All')
  const [showNew,   setShowNew]   = useState(false)

  const [newName,        setNewName]        = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newGoal,        setNewGoal]        = useState('')
  const [newStartDate,   setNewStartDate]   = useState('')
  const [newEndDate,     setNewEndDate]     = useState('')
  const [creating,       setCreating]       = useState(false)
  const [createError,    setCreateError]    = useState('')

  useEffect(() => { fetchCampaigns() }, [filter])

  async function fetchCampaigns() {
    setLoading(true)
    const status = filter === 'All' ? '' : filter.toLowerCase()
    const res = await fetch(`/api/campaigns${status ? `?status=${status}` : ''}`)
    if (res.ok) {
      const d = await res.json()
      setCampaigns(d.items ?? [])
    }
    setLoading(false)
  }

  async function createCampaign() {
    if (!newName.trim()) { setCreateError('Name is required'); return }
    setCreating(true)
    setCreateError('')
    const res = await fetch('/api/campaigns', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:        newName.trim(),
        description: newDescription.trim() || undefined,
        goal:        newGoal.trim() || undefined,
        startDate:   newStartDate || undefined,
        endDate:     newEndDate || undefined,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setCreating(false)
    if (!res.ok) { setCreateError(d.error ?? 'Failed to create campaign'); return }
    setShowNew(false)
    setNewName(''); setNewDescription(''); setNewGoal(''); setNewStartDate(''); setNewEndDate('')
    window.location.href = `/campaigns/${d.campaign.id}`
  }

  return (
    <div style={{ padding: '24px', background: '#0f0f13', minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 800, margin: 0 }}>Campaigns</h1>
          <p style={{ fontSize: '13px', color: '#7c7c9a', marginTop: '4px' }}>
            Group content into initiatives — plan, create, approve, schedule, and measure as one thing.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{ background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}
        >
          + New Campaign
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', margin: '20px 0', borderBottom: '1px solid #2a2a3a', paddingBottom: '2px' }}>
        {FILTER_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '8px 14px', fontSize: '13px', fontWeight: 600, fontFamily: 'Inter, sans-serif',
              color: filter === tab ? '#6c63ff' : '#7c7c9a',
              borderBottom: filter === tab ? '2px solid #6c63ff' : '2px solid transparent',
              marginBottom: '-2px', transition: 'color 0.15s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonContentCard key={i} />)}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon="🎯"
          title={filter === 'All' ? 'No campaigns yet' : `No ${filter.toLowerCase()} campaigns`}
          body="Campaigns group multiple pieces of content — across content types and platforms — under one initiative, so you can plan, approve, schedule, and measure them together instead of one piece at a time."
          cta={{ label: '+ New Campaign', href: '#', onClick: () => setShowNew(true) }}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {campaigns.map(c => {
            const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft
            const dateRange = c.start_date && c.end_date
              ? `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}`
              : c.start_date ? `From ${fmtDate(c.start_date)}` : c.end_date ? `Until ${fmtDate(c.end_date)}` : null

            return (
              <Link key={c.id} href={`/campaigns/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px',
                  padding: '18px', height: '100%', display: 'flex', flexDirection: 'column',
                  transition: 'border-color 0.15s, transform 0.15s', cursor: 'pointer',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#6c63ff'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a3a'; e.currentTarget.style.transform = 'none' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px' }}>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '15px', fontWeight: 700, lineHeight: 1.3 }}>{c.name}</div>
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, color: cfg.color, background: cfg.bg, borderRadius: '20px', padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {cfg.label}
                    </span>
                  </div>

                  {c.goal && <div style={{ fontSize: '11px', color: '#6c63ff', fontWeight: 600, marginBottom: '6px' }}>{c.goal}</div>}
                  {dateRange && <div style={{ fontSize: '11px', color: '#7c7c9a', marginBottom: '12px' }}>{dateRange}</div>}

                  <div style={{ display: 'flex', gap: '16px', marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid #2a2a3a' }}>
                    <div>
                      <div style={{ fontSize: '17px', fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>{c.pieceCount}</div>
                      <div style={{ fontSize: '10px', color: '#7c7c9a' }}>{c.pieceCount === 1 ? 'piece' : 'pieces'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '17px', fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>
                        {c.statusCounts.published ?? 0}
                      </div>
                      <div style={{ fontSize: '10px', color: '#7c7c9a' }}>published</div>
                    </div>
                    {c.avgEngagement != null && (
                      <div>
                        <div style={{ fontSize: '17px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: '#3ecf8e' }}>{c.avgEngagement}</div>
                        <div style={{ fontSize: '10px', color: '#7c7c9a' }}>avg score</div>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* New campaign modal */}
      {showNew && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowNew(false)}
        >
          <div
            style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '14px', padding: '24px', width: '420px', maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '17px', fontWeight: 700, marginBottom: '18px' }}>New Campaign</div>

            <label style={{ fontSize: '11px', fontWeight: 600, color: '#7c7c9a', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Name</label>
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Diwali 2026, Series A Announcement…"
              style={{ width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0', fontSize: '13px', fontFamily: 'Inter, sans-serif', marginBottom: '14px', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => (e.target.style.borderColor = '#6c63ff')} onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
            />

            <label style={{ fontSize: '11px', fontWeight: 600, color: '#7c7c9a', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Goal (optional)</label>
            <input
              value={newGoal} onChange={e => setNewGoal(e.target.value)}
              placeholder="Product Launch, Seasonal, Hiring…"
              style={{ width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0', fontSize: '13px', fontFamily: 'Inter, sans-serif', marginBottom: '14px', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => (e.target.style.borderColor = '#6c63ff')} onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
            />

            <label style={{ fontSize: '11px', fontWeight: 600, color: '#7c7c9a', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Description (optional)</label>
            <textarea
              value={newDescription} onChange={e => setNewDescription(e.target.value)}
              placeholder="What is this campaign about?"
              style={{ width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0', fontSize: '13px', fontFamily: 'Inter, sans-serif', marginBottom: '14px', outline: 'none', boxSizing: 'border-box', minHeight: '64px', resize: 'vertical' }}
              onFocus={e => (e.target.style.borderColor = '#6c63ff')} onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
            />

            <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#7c7c9a', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>Start date</label>
                <input
                  type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)}
                  style={{ width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '9px 10px', color: '#e8e8f0', fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => (e.target.style.borderColor = '#6c63ff')} onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#7c7c9a', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>End date</label>
                <input
                  type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)}
                  style={{ width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '9px 10px', color: '#e8e8f0', fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => (e.target.style.borderColor = '#6c63ff')} onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
                />
              </div>
            </div>

            {createError && <div style={{ fontSize: '12px', color: '#f06565', marginBottom: '12px' }}>{createError}</div>}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={createCampaign} disabled={creating}
                style={{ flex: 1, background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '13px', fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif', opacity: creating ? 0.7 : 1 }}
              >
                {creating ? 'Creating…' : 'Create Campaign'}
              </button>
              <button
                onClick={() => setShowNew(false)}
                style={{ background: 'transparent', color: '#7c7c9a', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '11px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
