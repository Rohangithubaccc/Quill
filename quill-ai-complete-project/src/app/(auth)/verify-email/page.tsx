'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

// How long the resend button is disabled after clicking (seconds)
const RESEND_COOLDOWN_SECS = 60

function VerifyEmailPageInner() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''

  // Resend state
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendError, setResendError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  // Tick cooldown timer down every second
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(id); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || resendStatus === 'sending') return
    setResendStatus('sending')
    setResendError('')

    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'rate_limited') {
          setResendError('Too many attempts. Please wait before trying again.')
        } else {
          setResendError(data.error ?? 'Something went wrong. Please try again.')
        }
        setResendStatus('error')
        return
      }

      setResendStatus('sent')
      setCooldown(RESEND_COOLDOWN_SECS)
    } catch {
      setResendError('Network error. Check your connection and try again.')
      setResendStatus('error')
    }
  }, [email, cooldown, resendStatus])

  const buttonDisabled = cooldown > 0 || resendStatus === 'sending'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #0f0f13; color: #e8e8f0; min-height: 100vh; }
      `}</style>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(108,99,255,0.12) 0%, transparent 60%)',
      }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{
                width: '36px', height: '36px',
                background: 'linear-gradient(135deg, #6c63ff, #f5c842)',
                borderRadius: '9px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '18px',
                boxShadow: '0 0 20px rgba(108,99,255,0.4)',
              }}>✦</div>
              <span style={{
                fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px',
                background: 'linear-gradient(135deg, #fff 40%, #f5c842)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>Quill.AI</span>
            </div>
          </div>

          {/* Card */}
          <div style={{
            background: '#1e1e28',
            border: '1px solid #2a2a3a',
            borderRadius: '16px',
            padding: '36px 32px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            textAlign: 'center',
          }}>

            {/* Envelope icon with radial glow */}
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(108,99,255,0.18), transparent)',
              border: '1px solid rgba(108,99,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '36px',
              margin: '0 auto 24px',
            }}>
              📧
            </div>

            {/* Heading */}
            <h1 style={{
              fontFamily: 'Syne, sans-serif',
              fontWeight: 800,
              fontSize: '28px',
              color: '#e8e8f0',
              marginBottom: '12px',
              lineHeight: 1.15,
            }}>
              Check your email
            </h1>

            {/* Body */}
            <p style={{
              fontSize: '14px',
              color: '#7c7c9a',
              lineHeight: 1.65,
              marginBottom: email ? '6px' : '24px',
            }}>
              We sent a confirmation link to
            </p>

            {email && (
              <p style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#e8e8f0',
                marginBottom: '6px',
                wordBreak: 'break-all',
              }}>
                {email}
              </p>
            )}

            <p style={{
              fontSize: '14px',
              color: '#7c7c9a',
              lineHeight: 1.65,
              marginBottom: '28px',
            }}>
              Click it to activate your account and start your 14-day free trial.
            </p>

            {/* Success toast */}
            {resendStatus === 'sent' && (
              <div style={{
                background: 'rgba(62,207,142,0.1)',
                border: '1px solid rgba(62,207,142,0.25)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#3ecf8e',
              }}>
                ✓ Email resent! Check your inbox (and spam folder).
              </div>
            )}

            {/* Error toast */}
            {resendStatus === 'error' && resendError && (
              <div style={{
                background: 'rgba(240,101,101,0.12)',
                border: '1px solid rgba(240,101,101,0.25)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#f06565',
              }}>
                {resendError}
              </div>
            )}

            {/* Resend button */}
            <button
              onClick={handleResend}
              disabled={buttonDisabled}
              style={{
                width: '100%',
                background: buttonDisabled ? '#2a2a3a' : '#6c63ff',
                color: buttonDisabled ? '#4a4a65' : '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: buttonDisabled ? 'not-allowed' : 'pointer',
                fontFamily: 'Inter, sans-serif',
                transition: 'all 0.18s',
                marginBottom: '16px',
              }}
            >
              {resendStatus === 'sending'
                ? '⏳ Sending…'
                : cooldown > 0
                ? `Resend in ${cooldown}s`
                : 'Resend confirmation email'}
            </button>

            {/* Spam note */}
            <p style={{
              fontSize: '12px',
              color: '#4a4a65',
              marginBottom: '24px',
              lineHeight: 1.5,
            }}>
              Check your spam folder if you don&apos;t see it.
            </p>

            {/* Divider */}
            <div style={{
              height: '1px',
              background: '#2a2a3a',
              marginBottom: '20px',
            }} />

            {/* Secondary links */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Link href="/login" style={{
                fontSize: '13px',
                color: '#6c63ff',
                textDecoration: 'none',
                fontWeight: 600,
              }}>
                Already confirmed? Sign in →
              </Link>
              <Link href="/signup" style={{
                fontSize: '13px',
                color: '#7c7c9a',
                textDecoration: 'none',
              }}>
                Wrong email? Sign up again →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f0f13', color:'#7c7c9a', fontFamily:'Inter, sans-serif', fontSize:'14px' }}>
        Loading…
      </div>
    }>
      <VerifyEmailPageInner />
    </Suspense>
  )
}
