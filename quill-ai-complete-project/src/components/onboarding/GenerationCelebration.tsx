'use client'
import { useEffect, useState } from 'react'

interface GenerationCelebrationProps {
  userId:     string
  onDismiss:  () => void
}

export function GenerationCelebration({ onDismiss }: GenerationCelebrationProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onDismiss() }, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '16px',
        padding: '40px', textAlign: 'center', maxWidth: '400px',
      }}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
        <div style={{
          fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 800,
          background: 'linear-gradient(135deg,#6c63ff,#f5c842)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: '8px',
        }}>
          Your first piece is ready!
        </div>
        <p style={{ fontSize: '14px', color: '#7c7c9a', marginBottom: '24px', lineHeight: 1.6 }}>
          Welcome to Quill.AI. Now let&apos;s schedule it.
        </p>
        <button
          onClick={() => { setVisible(false); onDismiss() }}
          style={{
            background: '#6c63ff', color: '#fff', border: 'none',
            borderRadius: '8px', padding: '12px 28px', fontSize: '14px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
          }}
        >
          Got it →
        </button>
      </div>
    </div>
  )
}
