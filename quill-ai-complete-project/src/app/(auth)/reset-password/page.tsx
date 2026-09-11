'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

function ResetPasswordPageInner() {
  const searchParams = useSearchParams()
  // Supabase appends #access_token to URL after clicking the magic link
  // In that flow, the page is type=recovery
  const [step, setStep] = useState<'request' | 'reset'>('request')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createSupabaseBrowserClient()

  // Detect if we're in the recovery flow (returned from magic link)
  // Supabase SSR sets the session automatically via the URL hash
  const isRecovery = typeof window !== 'undefined' &&
    window.location.hash.includes('type=recovery')

  const inputStyle = {
    width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a',
    borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0',
    fontSize: '14px', outline: 'none', fontFamily: 'Inter, sans-serif',
  } as React.CSSProperties

  async function handleRequestReset(e: FormEvent) {
    e.preventDefault()
    setError(''); setMessage(''); setLoading(true)

    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_URL}/reset-password`,
    })

    setLoading(false)
    if (err) setError(err.message)
    else setMessage('Check your email for a password reset link.')
  }

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setError(''); setLoading(true)

    const { error: err } = await supabase.auth.updateUser({ password })

    setLoading(false)
    if (err) setError(err.message)
    else {
      setMessage('Password updated! Redirecting to login…')
      setTimeout(() => window.location.href = '/dashboard', 1500)
    }
  }

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
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg,#6c63ff,#f5c842)', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>✦</div>
              <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px', background: 'linear-gradient(135deg, #fff 40%, #f5c842)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Quill.AI</span>
            </div>
            <div style={{ fontSize: '14px', color: '#7c7c9a' }}>
              {isRecovery ? 'Set your new password' : 'Reset your password'}
            </div>
          </div>

          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '16px', padding: '32px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
            {error && (
              <div style={{ background: 'rgba(240,101,101,0.12)', border: '1px solid rgba(240,101,101,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '20px', fontSize: '13px', color: '#f06565' }}>{error}</div>
            )}
            {message && (
              <div style={{ background: 'rgba(62,207,142,0.12)', border: '1px solid rgba(62,207,142,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '20px', fontSize: '13px', color: '#3ecf8e' }}>{message}</div>
            )}

            {!isRecovery ? (
              <form onSubmit={handleRequestReset}>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7c7c9a', marginBottom: '6px' }}>Email Address</label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com" style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = '#6c63ff')}
                    onBlur={e => (e.target.style.borderColor = '#2a2a3a')} />
                </div>
                <button type="submit" disabled={loading} style={{ width: '100%', background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSetPassword}>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7c7c9a', marginBottom: '6px' }}>New Password</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 characters" style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = '#6c63ff')}
                    onBlur={e => (e.target.style.borderColor = '#2a2a3a')} />
                </div>
                <button type="submit" disabled={loading} style={{ width: '100%', background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                  {loading ? 'Updating…' : 'Set New Password'}
                </button>
              </form>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: '#7c7c9a' }}>
            <Link href="/login" style={{ color: '#6c63ff', textDecoration: 'none' }}>← Back to sign in</Link>
          </div>
        </div>
      </div>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f0f13', color:'#7c7c9a', fontFamily:'Inter, sans-serif', fontSize:'14px' }}>
        Loading…
      </div>
    }>
      <ResetPasswordPageInner />
    </Suspense>
  )
}
