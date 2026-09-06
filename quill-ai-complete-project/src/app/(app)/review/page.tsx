'use client'

import { useState, useEffect, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ContentPiece {
  id:           string
  title:        string
  content:      string
  content_type: string
  industry:     string
  tone:         string
  status:       string
  created_at:   string
  updated_at:   string
  platform:     string[]
  created_by:   string
  current_stage_index: number | null
}

interface Comment {
  id:          string
  body:        string
  created_at:  string
  user_id:     string
  metadata:    { selectionOffset?: number; selectionText?: string; mentions?: string[] } | null
  resolved_at: string | null
  user_email:  string
}

// ─────────────────────────────────────────────────────────────────────────────
// Status config — includes the new 'needs_revision' state
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:          { label: 'Draft',          color: '#7c7c9a', bg: 'rgba(124,124,154,0.12)' },
  review:         { label: 'In Review',      color: '#4fb3f7', bg: 'rgba(79,179,247,0.12)'  },
  needs_revision: { label: 'Needs Revision', color: '#f59e42', bg: 'rgba(245,158,66,0.12)'  },
  approved:       { label: 'Approved',       color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)'  },
  rejected:       { label: 'Rejected',       color: '#f06565', bg: 'rgba(240,101,101,0.12)' },
  scheduled:      { label: 'Scheduled',      color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  published:      { label: 'Published',      color: '#6c63ff', bg: 'rgba(108,99,255,0.12)'  },
}

const FILTER_TABS = ['All', 'In Review', 'Needs Revision', 'Approved', 'Rejected']

const FILTER_TO_STATUS: Record<string, string | null> = {
  'All':            null,
  'In Review':      'review',
  'Needs Revision': 'needs_revision',
  'Approved':       'approved',
  'Rejected':       'rejected',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function extractMentions(text: string): string[] {
  const matches = text.match(/@([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi) ?? []
  // Also catch @word patterns (username-style mentions)
  const wordMatches = text.match(/@([a-zA-Z0-9_.-]+)/g) ?? []
  const all = [...matches, ...wordMatches].map(m => m.slice(1))
  return [...new Set(all)]
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  // ── Content list state ────────────────────────────────────────────────────
  const [pieces,       setPieces]       = useState<ContentPiece[]>([])
  const [loading,      setLoading]      = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')

  // ── Modal / detail state ──────────────────────────────────────────────────
  const [selectedPiece, setSelectedPiece] = useState<ContentPiece | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // ── Comments state ────────────────────────────────────────────────────────
  const [comments,        setComments]        = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newComment,      setNewComment]      = useState('')
  const [postingComment,  setPostingComment]  = useState('')   // tracks which contentId is posting
  const [resolvingComment, setResolvingComment] = useState('')  // tracks which commentId is resolving

  // ── Revision workflow state ───────────────────────────────────────────────
  const [revisionNote,       setRevisionNote]       = useState('')
  const [showRevisionInput,  setShowRevisionInput]  = useState<string | null>(null)

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast,     setToast]     = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // ── Multi-stage approval chain (optional per workspace) ─────────────────
  interface ApprovalStage { id: string; stage_index: number; name: string; required_role: string }
  const [approvalStages, setApprovalStages] = useState<ApprovalStage[]>([])
  interface HistoryEntry { id: string; stage_index: number|null; stage_name: string|null; action: string; actorEmail: string|null; note: string|null; created_at: string }
  const [approvalHistory, setApprovalHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [stageRejectNote, setStageRejectNote] = useState('')
  const [showStageReject, setShowStageReject] = useState(false)

  useEffect(() => {
    fetch('/api/workspace/approval-stages').then(r => r.ok ? r.json() : null).then(d => { if (d) setApprovalStages(d.stages ?? []) })
  }, [])

  async function loadApprovalHistory(contentId: string) {
    const res = await fetch(`/api/content/${contentId}/approval/history`)
    if (res.ok) { const d = await res.json(); setApprovalHistory(d.items ?? []) }
  }

  async function advanceStage(contentId: string) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/content/${contentId}/approval/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? 'Failed to advance')
      showToast(d.finalized ? 'Fully approved!' : `Advanced to: ${d.nextStageName}`)
      await fetchPieces()
      loadApprovalHistory(contentId)
    } catch (err: any) {
      showToast(err.message ?? 'Failed to advance stage', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  async function rejectStage(contentId: string) {
    if (!stageRejectNote.trim()) { showToast('A note is required to reject', 'error'); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/content/${contentId}/approval/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: stageRejectNote.trim() }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? 'Failed to reject')
      showToast('Sent back for revision')
      setShowStageReject(false)
      setStageRejectNote('')
      await fetchPieces()
      loadApprovalHistory(contentId)
    } catch (err: any) {
      showToast(err.message ?? 'Failed to reject', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data fetching
  // ─────────────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const fetchPieces = useCallback(async () => {
    setLoading(true)
    try {
      const statusFilter = FILTER_TO_STATUS[activeFilter]
      const qs = statusFilter ? `?status=${statusFilter}` : ''
      const res = await fetch(`/api/content${qs}`)
      if (!res.ok) throw new Error('Failed to load content')
      const data = await res.json()
      setPieces(data.pieces ?? data ?? [])
    } catch (err) {
      console.error('[review] fetchPieces:', err)
      showToast('Failed to load content', 'error')
    } finally {
      setLoading(false)
    }
  }, [activeFilter, showToast])

  useEffect(() => { fetchPieces() }, [fetchPieces])

  const fetchComments = useCallback(async (contentId: string) => {
    setCommentsLoading(true)
    try {
      const res = await fetch(`/api/content/${contentId}/comments`)
      if (res.ok) setComments(await res.json())
    } catch (err) {
      console.error('[review] fetchComments:', err)
    } finally {
      setCommentsLoading(false)
    }
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  async function updateStatus(contentId: string, status: string) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/content/${contentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setPieces(prev => prev.map(p => p.id === contentId ? { ...p, status } : p))
      if (selectedPiece?.id === contentId) {
        setSelectedPiece(prev => prev ? { ...prev, status } : prev)
      }
      const statusLabel = STATUS_CONFIG[status]?.label ?? status
      showToast(`Status updated to ${statusLabel}`)
    } catch (err: any) {
      showToast(err.message ?? 'Failed to update status', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleApprove(contentId: string) {
    await updateStatus(contentId, 'approved')
  }

  async function handleReject(contentId: string) {
    await updateStatus(contentId, 'rejected')
  }

  async function handleNeedsRevision(contentId: string) {
    if (!revisionNote.trim()) {
      showToast('Please add a revision note before submitting', 'error')
      return
    }
    setActionLoading(true)
    try {
      // 1. Post the revision note as a comment first
      const commentRes = await fetch(`/api/content/${contentId}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: revisionNote.trim() }),
      })
      if (!commentRes.ok) {
        const d = await commentRes.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to post revision note')
      }
      const newCommentData: Comment = await commentRes.json()

      // 2. Update status
      const statusRes = await fetch(`/api/content/${contentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'needs_revision' }),
      })
      if (!statusRes.ok) {
        const d = await statusRes.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to update status')
      }

      // 3. Update local state
      setPieces(prev => prev.map(p => p.id === contentId ? { ...p, status: 'needs_revision' } : p))
      if (selectedPiece?.id === contentId) {
        setSelectedPiece(prev => prev ? { ...prev, status: 'needs_revision' } : prev)
      }
      setComments(prev => [...prev, newCommentData])
      setRevisionNote('')
      setShowRevisionInput(null)
      showToast('Marked as Needs Revision')
    } catch (err: any) {
      showToast(err.message ?? 'Failed to submit revision', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  async function postComment(contentId: string) {
    if (!newComment.trim()) return
    setPostingComment(contentId)
    try {
      const mentions = extractMentions(newComment)
      const res = await fetch(`/api/content/${contentId}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          body:     newComment.trim(),
          mentions: mentions.length > 0 ? mentions : undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to post comment')
      }
      const created: Comment = await res.json()
      setComments(prev => [...prev, created])
      setNewComment('')
      showToast('Comment posted')
    } catch (err: any) {
      showToast(err.message ?? 'Failed to post comment', 'error')
    } finally {
      setPostingComment('')
    }
  }

  async function resolveComment(commentId: string, contentId: string, resolved: boolean) {
    setResolvingComment(commentId)
    try {
      const res = await fetch(`/api/content/${contentId}/comments/${commentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ resolved }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to resolve comment')
      }
      setComments(prev => prev.map(c =>
        c.id === commentId
          ? { ...c, resolved_at: resolved ? new Date().toISOString() : null }
          : c
      ))
    } catch (err: any) {
      showToast(err.message ?? 'Failed to resolve comment', 'error')
    } finally {
      setResolvingComment('')
    }
  }

  function openModal(piece: ContentPiece) {
    setSelectedPiece(piece)
    setComments([])
    setNewComment('')
    setRevisionNote('')
    setShowRevisionInput(null)
    fetchComments(piece.id)
  }

  function closeModal() {
    setSelectedPiece(null)
    setComments([])
    setNewComment('')
    setRevisionNote('')
    setShowRevisionInput(null)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────

  const unresolvedCount = comments.filter(c => !c.resolved_at).length

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#0b0b10', color: '#e8e8f0', fontFamily: 'Inter, -apple-system, sans-serif', padding: '32px 24px' }}>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          background: toast.type === 'success' ? 'rgba(62,207,142,0.15)' : 'rgba(240,101,101,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(62,207,142,0.4)' : 'rgba(240,101,101,0.4)'}`,
          borderRadius: '10px', padding: '12px 18px', fontSize: '13px',
          color: toast.type === 'success' ? '#3ecf8e' : '#f06565',
          backdropFilter: 'blur(12px)', maxWidth: '320px',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Review Queue
          </h1>
          <p style={{ fontSize: '14px', color: '#7c7c9a', margin: 0 }}>
            Approve, request revisions, or reject content before publishing.
          </p>
        </div>

        {/* ── Filter tabs ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '28px', flexWrap: 'wrap' }}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveFilter(tab)}
              style={{
                background:   activeFilter === tab ? '#6c63ff' : 'rgba(255,255,255,0.04)',
                color:        activeFilter === tab ? '#fff' : '#9898b8',
                border:       activeFilter === tab ? 'none' : '1px solid #2a2a3a',
                borderRadius: '8px', padding: '7px 16px', fontSize: '13px',
                fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ── Content card grid ─────────────────────────────────────────── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#7c7c9a', fontSize: '14px' }}>
            Loading content…
          </div>
        ) : pieces.length === 0 ? (
          /* ── Empty state ─────────────────────────────────────────────── */
          <div style={{
            textAlign: 'center', padding: '80px 24px',
            background: '#13131a', border: '1px solid #2a2a3a', borderRadius: '16px',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📋</div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px', color: '#e8e8f0' }}>
              {activeFilter === 'All' ? 'No content in the queue' : `No ${activeFilter.toLowerCase()} content`}
            </h3>
            <p style={{ fontSize: '14px', color: '#7c7c9a', margin: 0 }}>
              {activeFilter === 'All'
                ? 'Content submitted for review will appear here.'
                : `Switch to a different filter to see other content.`}
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '16px',
          }}>
            {pieces.map(piece => {
              const cfg = STATUS_CONFIG[piece.status] ?? STATUS_CONFIG['draft']
              return (
                <div
                  key={piece.id}
                  onClick={() => openModal(piece)}
                  style={{
                    background: '#13131a', border: '1px solid #2a2a3a', borderRadius: '12px',
                    padding: '20px', cursor: 'pointer', transition: 'border-color 0.15s, transform 0.1s',
                  }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLDivElement).style.borderColor = '#6c63ff'
                    ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a3a'
                    ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
                  }}
                >
                  {/* Status badge + type */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{
                      background: cfg.bg, color: cfg.color,
                      borderRadius: '6px', padding: '3px 10px', fontSize: '11px', fontWeight: 600,
                    }}>
                      {cfg.label}
                    </span>
                    {piece.content_type && (
                      <span style={{ fontSize: '11px', color: '#7c7c9a', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '3px 8px' }}>
                        {piece.content_type}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 8px', color: '#e8e8f0', lineHeight: 1.35, letterSpacing: '-0.01em' }}>
                    {piece.title || 'Untitled'}
                  </h3>

                  {/* Preview */}
                  <p style={{ fontSize: '13px', color: '#7c7c9a', margin: '0 0 16px', lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
                    {piece.content?.substring(0, 140)}…
                  </p>

                  {/* Meta row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#7c7c9a' }}>
                    <span>{timeAgo(piece.created_at)}</span>
                    <span style={{ color: '#6c63ff', fontWeight: 600 }}>Open →</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      {selectedPiece && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '40px 16px', overflowY: 'auto', backdropFilter: 'blur(4px)',
          }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            style={{
              background: '#13131a', border: '1px solid #2a2a3a', borderRadius: '16px',
              width: '100%', maxWidth: '760px', overflow: 'hidden',
              boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ padding: '24px 28px 0', borderBottom: '1px solid #2a2a3a', paddingBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {(() => {
                      const cfg = STATUS_CONFIG[selectedPiece.status] ?? STATUS_CONFIG['draft']
                      return (
                        <span style={{ background: cfg.bg, color: cfg.color, borderRadius: '6px', padding: '3px 10px', fontSize: '11px', fontWeight: 600 }}>
                          {cfg.label}
                        </span>
                      )
                    })()}
                    {selectedPiece.content_type && (
                      <span style={{ fontSize: '11px', color: '#7c7c9a' }}>
                        {selectedPiece.content_type}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
                    {selectedPiece.title || 'Untitled'}
                  </h2>
                </div>
                <button
                  onClick={closeModal}
                  style={{ background: 'none', border: 'none', color: '#7c7c9a', fontSize: '22px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Content body */}
            <div style={{ padding: '24px 28px', maxHeight: '320px', overflowY: 'auto', borderBottom: '1px solid #2a2a3a' }}>
              <pre style={{ fontSize: '14px', color: '#c8c8e0', lineHeight: '1.65', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif' }}>
                {selectedPiece.content}
              </pre>
            </div>

            {/* ── Approval action buttons ─────────────────────────────── */}
            <div style={{ padding: '20px 28px', borderBottom: '1px solid #2a2a3a' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#7c7c9a', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
                Review Decision
              </p>

              {/* Multi-stage approval chain indicator — only shown when this
                  workspace has configured stages AND this piece is actively
                  in the chain (current_stage_index set). Workspaces with no
                  configured stages never see this; the plain 3-state flow
                  below is unaffected either way. */}
              {approvalStages.length > 0 && selectedPiece.current_stage_index !== null && (
                <div style={{ background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#a29bff' }}>
                    Stage {selectedPiece.current_stage_index + 1} of {approvalStages.length}: {approvalStages.find(s => s.stage_index === selectedPiece.current_stage_index)?.name ?? 'Unknown stage'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#7c7c9a', marginTop: '2px' }}>
                    Requires {approvalStages.find(s => s.stage_index === selectedPiece.current_stage_index)?.required_role ?? 'admin'} role or higher (owners can always approve)
                  </div>
                  <button
                    onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadApprovalHistory(selectedPiece.id) }}
                    style={{ background: 'transparent', border: 'none', color: '#a29bff', fontSize: '11px', cursor: 'pointer', padding: '6px 0 0', fontFamily: 'Inter, sans-serif', textDecoration: 'underline' }}
                  >
                    {showHistory ? 'Hide' : 'View'} approval history
                  </button>
                  {showHistory && (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {approvalHistory.length === 0 ? (
                        <div style={{ fontSize: '11px', color: '#7c7c9a' }}>No history yet.</div>
                      ) : approvalHistory.map(h => (
                        <div key={h.id} style={{ fontSize: '11px', color: '#e8e8f0', borderLeft: `2px solid ${h.action === 'rejected' ? '#f06565' : '#3ecf8e'}`, paddingLeft: '8px' }}>
                          <strong>{h.stage_name ?? 'Stage'}</strong> — {h.action} by {h.actorEmail ?? 'someone'} on {new Date(h.created_at).toLocaleString()}
                          {h.note && <div style={{ color: '#7c7c9a', marginTop: '2px' }}>&ldquo;{h.note}&rdquo;</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {showRevisionInput === selectedPiece.id ? (
                /* Revision note input */
                <div>
                  <textarea
                    value={revisionNote}
                    onChange={e => setRevisionNote(e.target.value)}
                    placeholder="Describe what needs to be revised… (required)"
                    rows={3}
                    style={{
                      width: '100%', background: '#0f0f13', border: '1px solid #f59e42',
                      borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0',
                      fontSize: '13px', fontFamily: 'Inter, sans-serif', outline: 'none',
                      resize: 'vertical', boxSizing: 'border-box', marginBottom: '10px',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleNeedsRevision(selectedPiece.id)}
                      disabled={actionLoading || !revisionNote.trim()}
                      style={{
                        background: actionLoading || !revisionNote.trim() ? 'rgba(245,158,66,0.3)' : 'rgba(245,158,66,0.15)',
                        color: '#f59e42', border: '1px solid rgba(245,158,66,0.4)',
                        borderRadius: '8px', padding: '8px 18px', fontSize: '13px',
                        fontWeight: 600, cursor: actionLoading || !revisionNote.trim() ? 'not-allowed' : 'pointer',
                        fontFamily: 'Inter, sans-serif',
                      }}
                    >
                      {actionLoading ? 'Submitting…' : '↩ Submit Revision Note'}
                    </button>
                    <button
                      onClick={() => { setShowRevisionInput(null); setRevisionNote('') }}
                      style={{
                        background: 'none', color: '#7c7c9a', border: '1px solid #2a2a3a',
                        borderRadius: '8px', padding: '8px 14px', fontSize: '13px',
                        cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : approvalStages.length > 0 && selectedPiece.current_stage_index !== null ? (
                /* Stage-aware approval buttons — replaces the plain 3-state
                   buttons only while this piece is actively inside a
                   configured chain. */
                showStageReject ? (
                  <div>
                    <textarea
                      value={stageRejectNote}
                      onChange={e => setStageRejectNote(e.target.value)}
                      placeholder="Explain what needs to change… (required)"
                      rows={3}
                      style={{
                        width: '100%', background: '#0f0f13', border: '1px solid #f06565',
                        borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0',
                        fontSize: '13px', fontFamily: 'Inter, sans-serif', outline: 'none',
                        resize: 'vertical', boxSizing: 'border-box', marginBottom: '10px',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => rejectStage(selectedPiece.id)}
                        disabled={actionLoading || !stageRejectNote.trim()}
                        style={{ background: 'rgba(240,101,101,0.15)', color: '#f06565', border: '1px solid rgba(240,101,101,0.4)', borderRadius: '8px', padding: '8px 18px', fontSize: '13px', fontWeight: 600, cursor: actionLoading || !stageRejectNote.trim() ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif' }}
                      >
                        {actionLoading ? 'Submitting…' : 'Send back for revision'}
                      </button>
                      <button
                        onClick={() => { setShowStageReject(false); setStageRejectNote('') }}
                        style={{ background: 'none', color: '#7c7c9a', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => advanceStage(selectedPiece.id)}
                      disabled={actionLoading}
                      style={{ background: 'rgba(62,207,142,0.12)', color: '#3ecf8e', border: '1px solid rgba(62,207,142,0.3)', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif' }}
                    >
                      ✓ Approve this stage
                    </button>
                    <button
                      onClick={() => setShowStageReject(true)}
                      disabled={actionLoading}
                      style={{ background: 'rgba(240,101,101,0.1)', color: '#f06565', border: '1px solid rgba(240,101,101,0.25)', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif' }}
                    >
                      ↩ Send back
                    </button>
                  </div>
                )
              ) : (
                /* 3-state action buttons */
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {/* Approve */}
                  <button
                    onClick={() => handleApprove(selectedPiece.id)}
                    disabled={actionLoading}
                    style={{
                      background:  actionLoading ? 'rgba(62,207,142,0.1)' : 'rgba(62,207,142,0.12)',
                      color:       '#3ecf8e',
                      border:      '1px solid rgba(62,207,142,0.3)',
                      borderRadius:'8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600,
                      cursor:      actionLoading ? 'not-allowed' : 'pointer',
                      fontFamily:  'Inter, sans-serif', transition: 'all 0.15s',
                    }}
                  >
                    ✓ Approve
                  </button>

                  {/* Needs Revision */}
                  <button
                    onClick={() => setShowRevisionInput(selectedPiece.id)}
                    disabled={actionLoading}
                    style={{
                      background:  'rgba(245,158,66,0.1)',
                      color:       '#f59e42',
                      border:      '1px solid rgba(245,158,66,0.25)',
                      borderRadius:'8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600,
                      cursor:      actionLoading ? 'not-allowed' : 'pointer',
                      fontFamily:  'Inter, sans-serif', transition: 'all 0.15s',
                    }}
                  >
                    ↩ Needs Revision
                  </button>

                  {/* Reject */}
                  <button
                    onClick={() => handleReject(selectedPiece.id)}
                    disabled={actionLoading}
                    style={{
                      background:  'rgba(240,101,101,0.1)',
                      color:       '#f06565',
                      border:      '1px solid rgba(240,101,101,0.25)',
                      borderRadius:'8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600,
                      cursor:      actionLoading ? 'not-allowed' : 'pointer',
                      fontFamily:  'Inter, sans-serif', transition: 'all 0.15s',
                    }}
                  >
                    ✕ Reject
                  </button>
                </div>
              )}
            </div>

            {/* ── Comments panel ─────────────────────────────────────────── */}
            <div style={{ padding: '20px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#e8e8f0' }}>
                  Comments
                </span>
                <span style={{
                  background: unresolvedCount > 0 ? 'rgba(108,99,255,0.15)' : 'rgba(255,255,255,0.06)',
                  color: unresolvedCount > 0 ? '#a8a3ff' : '#7c7c9a',
                  borderRadius: '99px', padding: '1px 8px', fontSize: '11px', fontWeight: 600,
                }}>
                  {comments.length}
                </span>
                {unresolvedCount > 0 && (
                  <span style={{ fontSize: '11px', color: '#7c7c9a' }}>
                    · {unresolvedCount} unresolved
                  </span>
                )}
              </div>

              {/* Comment list */}
              {commentsLoading ? (
                <div style={{ fontSize: '13px', color: '#7c7c9a', padding: '12px 0' }}>
                  Loading comments…
                </div>
              ) : comments.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#7c7c9a', padding: '8px 0 16px' }}>
                  No comments yet. Be the first to leave feedback.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                  {comments.map(comment => {
                    const isResolved = !!comment.resolved_at
                    const displayEmail = comment.user_email?.split('@')[0] || 'user'
                    const isResolving  = resolvingComment === comment.id

                    return (
                      <div
                        key={comment.id}
                        style={{
                          opacity:      isResolved ? 0.5 : 1,
                          background:   '#0f0f17',
                          border:       '1px solid #222230',
                          borderRadius: '10px',
                          padding:      '14px 16px',
                          transition:   'opacity 0.2s',
                        }}
                      >
                        {/* Comment header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {/* Avatar */}
                            <div style={{
                              width: '26px', height: '26px', borderRadius: '50%',
                              background: 'linear-gradient(135deg, #6c63ff, #4fb3f7)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '11px', fontWeight: 700, color: '#fff', flexShrink: 0,
                            }}>
                              {displayEmail[0]?.toUpperCase() ?? '?'}
                            </div>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#c8c8e0' }}>
                              {displayEmail}
                            </span>
                            <span style={{ fontSize: '11px', color: '#7c7c9a' }}>
                              {timeAgo(comment.created_at)}
                            </span>
                          </div>

                          {/* Right side: resolved badge or resolve button */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isResolved ? (
                              <span style={{ fontSize: '10px', fontWeight: 600, color: '#3ecf8e', background: 'rgba(62,207,142,0.1)', borderRadius: '4px', padding: '2px 6px', letterSpacing: '0.04em' }}>
                                RESOLVED
                              </span>
                            ) : (
                              <button
                                onClick={() => resolveComment(comment.id, selectedPiece.id, true)}
                                disabled={isResolving}
                                style={{
                                  background: 'none', color: '#7c7c9a', border: '1px solid #2a2a3a',
                                  borderRadius: '6px', padding: '3px 8px', fontSize: '11px',
                                  cursor: isResolving ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif',
                                }}
                              >
                                {isResolving ? '…' : 'Resolve'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Selection text blockquote */}
                        {comment.metadata?.selectionText && (
                          <div style={{
                            borderLeft: '2px solid #6c63ff', paddingLeft: '10px',
                            marginBottom: '8px', fontSize: '12px', color: '#9898b8',
                            fontStyle: 'italic', lineHeight: 1.5,
                          }}>
                            &ldquo;{comment.metadata.selectionText}&rdquo;
                          </div>
                        )}

                        {/* Comment body */}
                        <p style={{ fontSize: '13px', color: '#c8c8e0', margin: 0, lineHeight: '1.6', wordBreak: 'break-word' }}>
                          {comment.body}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── Add comment form ──────────────────────────────────── */}
              <div>
                <textarea
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      postComment(selectedPiece.id)
                    }
                  }}
                  placeholder="Add a comment… Use @email to mention a teammate"
                  rows={3}
                  style={{
                    width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a',
                    borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0',
                    fontSize: '13px', fontFamily: 'Inter, sans-serif', outline: 'none',
                    resize: 'vertical', boxSizing: 'border-box', marginBottom: '8px',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#6c63ff')}
                  onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#7c7c9a' }}>
                    ⌘↵ to submit
                  </span>
                  <button
                    onClick={() => postComment(selectedPiece.id)}
                    disabled={!newComment.trim() || postingComment === selectedPiece.id}
                    style={{
                      background: !newComment.trim() || postingComment ? 'rgba(108,99,255,0.3)' : '#6c63ff',
                      color: '#fff', border: 'none', borderRadius: '8px',
                      padding: '8px 18px', fontSize: '13px', fontWeight: 600,
                      cursor: !newComment.trim() || postingComment ? 'not-allowed' : 'pointer',
                      fontFamily: 'Inter, sans-serif', transition: 'all 0.15s',
                    }}
                  >
                    {postingComment === selectedPiece.id ? 'Posting…' : 'Post Comment'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
