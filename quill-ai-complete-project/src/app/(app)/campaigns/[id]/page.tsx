'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface CampaignDetail {
  id:          string
  name:        string
  description: string | null
  goal:        string | null
  status:      string
  start_date:  string | null
  end_date:    string | null
  created_at:  string
}

interface Piece {
  id:               string
  title:            string | null
  content_type:     string
  platforms:        string[]
  status:           string
  engagement_score: number | null
  word_count:       number | null
  published_url:    string | null
  created_at:       string
}

interface Rollup {
  pieceCount:    number
  statusCounts:  Record<string, number>
  avgEngagement: number | null
  platforms:     string[]
}

const CAMPAIGN_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Draft',     color: '#7c7c9a', bg: 'rgba(124,124,154,0.12)' },
  active:    { label: 'Active',    color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)'  },
  completed: { label: 'Completed', color: '#6c63ff', bg: 'rgba(108,99,255,0.12)'  },
  archived:  { label: 'Archived',  color: '#4a4a65', bg: 'rgba(74,74,101,0.12)'   },
}

const PIECE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:          { label: 'Draft',          color: '#7c7c9a', bg: 'rgba(124,124,154,0.12)' },
  review:         { label: 'In Review',      color: '#4fb3f7', bg: 'rgba(79,179,247,0.12)'  },
  needs_revision: { label: 'Needs Revision', color: '#f59e42', bg: 'rgba(245,158,66,0.12)'  },
  approved:       { label: 'Approved',       color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)'  },
  rejected:       { label: 'Rejected',       color: '#f06565', bg: 'rgba(240,101,101,0.12)' },
  scheduled:      { label: 'Scheduled',      color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  published:      { label: 'Published',      color: '#6c63ff', bg: 'rgba(108,99,255,0.12)'  },
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CampaignDetailPage() {
  const router = useRouter()
  // Next.js 15 made the `params` prop passed to page components a Promise
  // (must be awaited in Server Components, or unwrapped with React's
  // use() hook in Client Components — the latter needs React 19, which
  // this app doesn't run). useParams() from next/navigation sidesteps
  // this entirely: it's a client-side hook reading the current route's
  // dynamic segments directly, unaffected by that prop-level change, and
  // matches how this app already reads query params via
  // useSearchParams() elsewhere (login, generator, settings, etc.).
  const params = useParams<{ id: string }>()
  const campaignId = params.id

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [pieces,   setPieces]   = useState<Piece[]>([])
  const [rollup,   setRollup]   = useState<Rollup | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [toast,    setToast]    = useState<{msg:string;type:'success'|'error'|'info'}|null>(null)

  const [editingName, setEditingName] = useState(false)
  const [nameDraft,   setNameDraft]   = useState('')
  const [savingField, setSavingField] = useState(false)

  const [showAddContent, setShowAddContent] = useState(false)
  const [pickerItems,    setPickerItems]    = useState<Piece[]>([])
  const [pickerLoading,  setPickerLoading]  = useState(false)
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set())
  const [addingContent,  setAddingContent]  = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function showToast(msg: string, type: 'success'|'error'|'info' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { fetchDetail() }, [campaignId])

  async function fetchDetail() {
    setLoading(true)
    const res = await fetch(`/api/campaigns/${campaignId}`)
    if (res.status === 404) { setNotFound(true); setLoading(false); return }
    if (res.ok) {
      const d = await res.json()
      setCampaign(d.campaign)
      setPieces(d.pieces ?? [])
      setRollup(d.rollup ?? null)
    }
    setLoading(false)
  }

  async function updateCampaign(patch: Record<string, unknown>) {
    setSavingField(true)
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setSavingField(false)
    if (!res.ok) { showToast('Update failed', 'error'); return }
    const d = await res.json()
    setCampaign(d.campaign)
  }

  async function saveName() {
    if (!nameDraft.trim()) { setEditingName(false); return }
    await updateCampaign({ name: nameDraft.trim() })
    setEditingName(false)
  }

  async function removeFromCampaign(pieceId: string) {
    const res = await fetch(`/api/content/${pieceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: null }),
    })
    if (!res.ok) { showToast('Failed to remove', 'error'); return }
    setPieces(prev => prev.filter(p => p.id !== pieceId))
    showToast('Removed from campaign', 'info')
    fetchDetail()   // refresh rollup
  }

  async function openAddContentPicker() {
    setShowAddContent(true)
    setPickerLoading(true)
    setPickerSelected(new Set())
    const res = await fetch('/api/content?limit=100')
    if (res.ok) {
      const d = await res.json()
      setPickerItems((d.items ?? []).filter((p: any) => p.campaign_id !== campaignId))
    }
    setPickerLoading(false)
  }

  function togglePicker(id: string) {
    setPickerSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function addSelectedContent() {
    if (pickerSelected.size === 0) return
    setAddingContent(true)
    await Promise.all(Array.from(pickerSelected).map(id =>
      fetch(`/api/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId }),
      })
    ))
    setAddingContent(false)
    setShowAddContent(false)
    showToast(`Added ${pickerSelected.size} piece${pickerSelected.size === 1 ? '' : 's'} to campaign`, 'success')
    fetchDetail()
  }

  async function deleteCampaign() {
    setDeleting(true)
    const res = await fetch(`/api/campaigns/${campaignId}`, { method: 'DELETE' })
    setDeleting(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      showToast(d.error ?? 'Failed to delete campaign', 'error')
      return
    }
    router.push('/campaigns')
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', background: '#0f0f13', minHeight: '100%', color: '#7c7c9a', fontFamily: 'Inter, sans-serif', fontSize: '13px' }}>
        Loading campaign…
      </div>
    )
  }

  if (notFound || !campaign) {
    return (
      <div style={{ padding: '24px', background: '#0f0f13', minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        <div style={{ fontSize: '40px', opacity: 0.4 }}>🎯</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700 }}>Campaign not found</div>
        <Link href="/campaigns" style={{ color: '#6c63ff', fontSize: '13px', textDecoration: 'none' }}>← Back to Campaigns</Link>
      </div>
    )
  }

  const cfg = CAMPAIGN_STATUS_CONFIG[campaign.status] ?? CAMPAIGN_STATUS_CONFIG.draft
  const dateRange = campaign.start_date && campaign.end_date
    ? `${fmtDate(campaign.start_date)} – ${fmtDate(campaign.end_date)}`
    : campaign.start_date ? `From ${fmtDate(campaign.start_date)}` : campaign.end_date ? `Until ${fmtDate(campaign.end_date)}` : null

  return (
    <div style={{ padding: '24px', background: '#0f0f13', minHeight: '100%' }}>
      {toast && (
        <div style={{ position:'fixed', bottom:'24px', right:'24px', zIndex:9999, background:'#16161d', border:'1px solid #2a2a3a', borderLeft:`3px solid ${toast.type==='success'?'#3ecf8e':toast.type==='error'?'#f06565':'#6c63ff'}`, borderRadius:'10px', padding:'12px 16px', fontSize:'13px', fontWeight:500, boxShadow:'0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      <Link href="/campaigns" style={{ color: '#7c7c9a', fontSize: '12px', textDecoration: 'none', display: 'inline-block', marginBottom: '14px' }}>
        ← All Campaigns
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: '260px' }}>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
              style={{ fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 800, background: '#1e1e28', border: '1px solid #6c63ff', borderRadius: '8px', padding: '4px 10px', color: '#e8e8f0', outline: 'none', width: '100%', maxWidth: '500px' }}
            />
          ) : (
            <h1
              onClick={() => { setNameDraft(campaign.name); setEditingName(true) }}
              style={{ fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 800, margin: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              title="Click to rename"
            >
              {campaign.name}
              <span style={{ fontSize: '12px', color: '#4a4a65' }}>✏️</span>
            </h1>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' }}>
            <select
              value={campaign.status}
              onChange={e => updateCampaign({ status: e.target.value })}
              disabled={savingField}
              style={{
                fontSize: '11px', fontWeight: 700, color: cfg.color, background: cfg.bg,
                border: 'none', borderRadius: '20px', padding: '4px 12px 4px 10px',
                textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
            >
              {Object.entries(CAMPAIGN_STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {campaign.goal && <span style={{ fontSize: '12px', color: '#6c63ff', fontWeight: 600 }}>{campaign.goal}</span>}
            {dateRange && <span style={{ fontSize: '12px', color: '#7c7c9a' }}>{dateRange}</span>}
          </div>

          {campaign.description && <p style={{ fontSize: '13px', color: '#7c7c9a', marginTop: '10px', maxWidth: '600px', lineHeight: 1.5 }}>{campaign.description}</p>}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <Link
            href={`/generator?campaign=${campaignId}`}
            style={{ background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            ✦ Generate for this campaign
          </Link>
          <button
            onClick={openAddContentPicker}
            style={{ background: 'transparent', color: '#e8e8f0', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}
          >
            + Add existing
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete campaign"
            style={{ background: 'transparent', color: '#f06565', border: '1px solid rgba(240,101,101,0.25)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
          >
            🗑
          </button>
        </div>
      </div>

      {/* Rollup stats */}
      {rollup && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>{rollup.pieceCount}</div>
            <div style={{ fontSize: '11px', color: '#7c7c9a' }}>Total pieces</div>
          </div>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: '#3ecf8e' }}>{rollup.statusCounts.published ?? 0}</div>
            <div style={{ fontSize: '11px', color: '#7c7c9a' }}>Published</div>
          </div>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'Syne, sans-serif', color: '#4fb3f7' }}>
              {(rollup.statusCounts.review ?? 0) + (rollup.statusCounts.needs_revision ?? 0)}
            </div>
            <div style={{ fontSize: '11px', color: '#7c7c9a' }}>In review</div>
          </div>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>{rollup.avgEngagement ?? '—'}</div>
            <div style={{ fontSize: '11px', color: '#7c7c9a' }}>Avg engagement</div>
          </div>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>{rollup.platforms.length > 0 ? rollup.platforms.join(', ') : '—'}</div>
            <div style={{ fontSize: '11px', color: '#7c7c9a', marginTop: '4px' }}>Platforms</div>
          </div>
        </div>
      )}

      {/* Content pieces */}
      <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #2a2a3a', fontSize: '13px', fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>
          Content in this campaign
        </div>
        {pieces.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#7c7c9a', fontSize: '13px' }}>
            No content yet. Generate something new or add existing pieces above.
          </div>
        ) : (
          pieces.map(p => {
            const pcfg = PIECE_STATUS_CONFIG[p.status] ?? PIECE_STATUS_CONFIG.draft
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', borderBottom: '1px solid #2a2a3a' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#e8e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#7c7c9a', marginTop: '2px' }}>
                    {p.content_type} · {(p.platforms ?? []).join(', ') || 'No platform'} {p.word_count ? `· ${p.word_count} words` : ''}
                  </div>
                </div>
                {p.engagement_score != null && (
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#3ecf8e', flexShrink: 0 }}>{p.engagement_score}</div>
                )}
                <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, color: pcfg.color, background: pcfg.bg, borderRadius: '20px', padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {pcfg.label}
                </span>
                <button
                  onClick={() => removeFromCampaign(p.id)}
                  title="Remove from campaign"
                  style={{ flexShrink: 0, background: 'transparent', border: 'none', color: '#7c7c9a', cursor: 'pointer', fontSize: '13px', padding: '4px' }}
                >
                  ✕
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Add existing content modal */}
      {showAddContent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowAddContent(false)}>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '14px', padding: '20px', width: '520px', maxWidth: '90vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Add existing content</div>
            <div style={{ fontSize: '12px', color: '#7c7c9a', marginBottom: '14px' }}>Select pieces to add to this campaign.</div>

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #2a2a3a', borderRadius: '8px' }}>
              {pickerLoading ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#7c7c9a', fontSize: '12px' }}>Loading…</div>
              ) : pickerItems.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#7c7c9a', fontSize: '12px' }}>No other content available to add.</div>
              ) : (
                pickerItems.map(p => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: '1px solid #2a2a3a', cursor: 'pointer' }}>
                    <input type="checkbox" checked={pickerSelected.has(p.id)} onChange={() => togglePicker(p.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: '#e8e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || 'Untitled'}</div>
                      <div style={{ fontSize: '11px', color: '#7c7c9a' }}>{p.content_type} · {p.status}</div>
                    </div>
                  </label>
                ))
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
              <button
                onClick={addSelectedContent}
                disabled={addingContent || pickerSelected.size === 0}
                style={{ flex: 1, background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '13px', fontWeight: 600, cursor: pickerSelected.size === 0 ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif', opacity: addingContent || pickerSelected.size === 0 ? 0.6 : 1 }}
              >
                {addingContent ? 'Adding…' : `Add ${pickerSelected.size || ''}`.trim()}
              </button>
              <button onClick={() => setShowAddContent(false)} style={{ background: 'transparent', color: '#7c7c9a', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '11px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowDeleteConfirm(false)}>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '14px', padding: '22px', width: '380px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Delete this campaign?</div>
            <p style={{ fontSize: '13px', color: '#7c7c9a', lineHeight: 1.5, marginBottom: '18px' }}>
              This only removes the campaign grouping — none of the {rollup?.pieceCount ?? 0} content pieces will be deleted.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={deleteCampaign}
                disabled={deleting}
                style={{ flex: 1, background: '#f06565', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? 'Deleting…' : 'Delete Campaign'}
              </button>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ background: 'transparent', color: '#7c7c9a', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '11px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
