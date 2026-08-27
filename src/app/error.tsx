'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import('@sentry/nextjs').then((Sentry) => {
        Sentry.captureException(error)
      }).catch(() => {})
    }
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0f0f13', color: '#e8e8f0', fontFamily: 'Inter, sans-serif' }}>
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '40px 24px',
        }}>
          <div style={{
            background: '#1e1e28', border: '1px solid rgba(240,101,101,0.35)',
            borderRadius: '16px', padding: '40px', textAlign: 'center',
            maxWidth: '440px', width: '100%',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 700, marginBottom: '10px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: '13px', color: '#7c7c9a', lineHeight: 1.6, marginBottom: '24px' }}>
              Quill.AI encountered an unexpected error.
              {error.digest && <><br /><code style={{ fontSize: '11px', color: '#4a4a65' }}>Ref: {error.digest}</code></>}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={reset} style={{ background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 22px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                ↺ Try Again
              </button>
              <button onClick={() => window.location.href = '/'} style={{ background: 'transparent', color: '#7c7c9a', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 18px', fontSize: '14px', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                Go Home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}
