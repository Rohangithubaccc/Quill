'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmDialog
//
// Shared confirmation modal for destructive/irreversible actions. Found
// during a ruthless adversarial pass that six destructive actions across
// the app (asset delete, KB document delete, BYOK key removal, invite
// revoke, webhook delete, domain removal) fired immediately on a single
// click with no confirmation step at all — inconsistent with campaign
// delete and GDPR account deletion, which already had proper guards. This
// component gives every one of those six the same protection, using the
// same visual language (dark modal, backdrop click-to-close via
// stopPropagation on the inner card) already established by
// UpgradeModal.tsx and the campaign-delete modal in campaigns/[id]/page.tsx.
// ─────────────────────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  isOpen:       boolean
  title:        string
  description:  string
  confirmLabel?: string
  cancelLabel?:  string
  loading?:      boolean
  danger?:       boolean   // red confirm button (default true — every current use is destructive)
  onConfirm:     () => void
  onCancel:      () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel  = 'Cancel',
  loading      = false,
  danger       = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(6px)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}
      onClick={e => { if (e.target === e.currentTarget && !loading) onCancel() }}
    >
      <div
        style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'14px', padding:'22px', width:'380px', maxWidth:'90vw', boxShadow:'0 32px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontFamily:'Syne, sans-serif', fontSize:'16px', fontWeight:700, marginBottom:'8px' }}>
          {title}
        </div>
        <p style={{ fontSize:'13px', color:'#7c7c9a', lineHeight:1.5, marginBottom:'18px' }}>
          {description}
        </p>
        <div style={{ display:'flex', gap:'8px' }}>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex:1,
              background: danger ? '#f06565' : '#6c63ff',
              color:'#fff', border:'none', borderRadius:'8px', padding:'11px',
              fontSize:'13px', fontWeight:600, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily:'Inter, sans-serif', opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              flex:1, background:'transparent', color:'#7c7c9a', border:'1px solid #2a2a3a',
              borderRadius:'8px', padding:'11px', fontSize:'13px', fontWeight:600,
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily:'Inter, sans-serif',
            }}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
