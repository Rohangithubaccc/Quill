'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin — can manage team and settings',
  editor: 'Editor — can create and publish content',
  viewer: 'Viewer — can view content only',
}

export default function InviteAcceptClient({
  token, email, role, workspaceName, inviterName, expiresAt,
}: {
  token: string; email: string; role: string
  workspaceName: string; inviterName: string; expiresAt: string
}) {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleAccept() {
    setLoading(true)
    setError('')

    // Check if user is logged in
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      // Redirect to signup with invite token param
      router.push(`/signup?invite=${token}`)
      return
    }

    // User is logged in — call accept API
    const res = await fetch('/api/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Failed to accept invitation')
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  const expiry = new Date(expiresAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0f13; color: #e8e8f0; font-family: 'Inter', sans-serif; }
      `}</style>

      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '24px',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(108,99,255,0.12) 0%, transparent 60%)',
      }}>
        <div style={{ width: '100%', maxWidth: '420px' }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '36px', height: '36px', background: 'linear-gradient(135deg,#6c63ff,#f5c842)',
                borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '18px', boxShadow: '0 0 20px rgba(108,99,255,0.4)',
              }}>✦</div>
              <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px', background: 'linear-gradient(135deg,#fff 40%,#f5c842)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Quill.AI</span>
            </div>
          </div>

          <div style={{
            background: '#1e1e28', border: '1px solid #2a2a3a',
            borderRadius: '16px', padding: '32px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🎉</div>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '20px', marginBottom: '6px' }}>
                You&rsquo;re invited!
              </h2>
              <p style={{ fontSize: '14px', color: '#7c7c9a', lineHeight: 1.6 }}>
                <strong style={{ color: '#e8e8f0' }}>{inviterName}</strong> invited you to join{' '}
                <strong style={{ color: '#e8e8f0' }}>{workspaceName}</strong> on Quill.AI.
              </p>
            </div>

            {/* Role badge */}
            <div style={{
              background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.25)',
              borderRadius: '8px', padding: '14px 16px', marginBottom: '24px',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7c7c9a', marginBottom: '4px' }}>
                Your Role
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#6c63ff' }}>
                {ROLE_LABELS[role] ?? role}
              </div>
            </div>

            {error && (
              <div style={{
                background: 'rgba(240,101,101,0.12)', border: '1px solid rgba(240,101,101,0.25)',
                borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
                fontSize: '13px', color: '#f06565',
              }}>{error}</div>
            )}

            <button
              onClick={handleAccept}
              disabled={loading}
              style={{
                width: '100%', background: '#6c63ff', color: '#fff',
                border: 'none', borderRadius: '8px', padding: '13px',
                fontSize: '15px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Inter, sans-serif', opacity: loading ? 0.75 : 1,
                marginBottom: '12px',
              }}
            >
              {loading ? '⏳ Joining…' : '✓ Accept Invitation'}
            </button>

            <a href="/dashboard" style={{
              display: 'block', textAlign: 'center', fontSize: '13px',
              color: '#7c7c9a', textDecoration: 'none',
            }}>
              Decline
            </a>

            <p style={{ fontSize: '11px', color: '#4a4a65', textAlign: 'center', marginTop: '16px' }}>
              Expires {expiry} · Sent to {email}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
