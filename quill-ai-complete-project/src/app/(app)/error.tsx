'use client'

import { useEffect } from 'react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Capture to Sentry if configured
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import('@sentry/nextjs').then((Sentry) => {
        Sentry.captureException(error)
      }).catch(() => {})
    }
    console.error('[AppError]', error)
  }, [error])

  return (
    <div style={{
      minHeight: '100%', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '40px 24px',
      background: '#0f0f13',
    }}>
      <div style={{
        background: '#1e1e28', border: '1px solid rgba(240,101,101,0.35)',
        borderRadius: '16px', padding: '40px', textAlign: 'center',
        maxWidth: '440px', width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: '50%',
          background: 'rgba(240,101,101,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '28px', margin: '0 auto 20px',
        }}>⚠️</div>

        <h2 style={{
          fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '20px',
          color: '#e8e8f0', marginBottom: '10px',
        }}>
          Page Error
        </h2>

        <p style={{ fontSize: '13px', color: '#7c7c9a', lineHeight: 1.6, marginBottom: '24px' }}>
          This page encountered an unexpected error. Your data is safe.
          {error.digest && (
            <><br /><span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#4a4a65' }}>
              Ref: {error.digest}
            </span></>
          )}
        </p>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              background: '#6c63ff', color: '#fff', border: 'none',
              borderRadius: '8px', padding: '10px 22px',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            ↺ Try Again
          </button>
          <button
            onClick={() => window.location.href = '/dashboard'}
            style={{
              background: 'transparent', color: '#7c7c9a',
              border: '1px solid #2a2a3a', borderRadius: '8px',
              padding: '10px 18px', fontSize: '14px', cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
