'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
  section?: string
}

interface State {
  hasError: boolean
  error: Error | null
  eventId: string | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, eventId: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Dynamically import Sentry to avoid bundle bloat when Sentry is unconfigured
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import('@sentry/nextjs').then((Sentry) => {
        const eventId = Sentry.captureException(error, {
          extra: {
            componentStack: info.componentStack,
            section: this.props.section,
          },
        })
        this.setState({ eventId: String(eventId) })
      }).catch(() => { /* Sentry not available */ })
    }

    // Always log to console in dev
    if (process.env.NODE_ENV === 'development') {
      console.error(`[ErrorBoundary:${this.props.section ?? 'unknown'}]`, error, info)
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, eventId: null })
  }

  handleReport = () => {
    if (!this.state.eventId) return
    import('@sentry/nextjs').then((Sentry) => {
      Sentry.showReportDialog({ eventId: this.state.eventId! })
    }).catch(() => { /* Sentry not available */ })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    const isDev = process.env.NODE_ENV === 'development'

    return (
      <div style={{
        background: '#1e1e28',
        border: '1px solid rgba(240,101,101,0.4)',
        borderRadius: '12px',
        padding: '32px',
        margin: '24px',
        textAlign: 'center',
        maxWidth: '480px',
        marginLeft: 'auto',
        marginRight: 'auto',
      }}>
        {/* Error icon */}
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'rgba(240,101,101,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '24px', margin: '0 auto 16px',
        }}>⚠️</div>

        <h3 style={{
          fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '18px',
          color: '#e8e8f0', marginBottom: '8px',
        }}>
          Something went wrong
        </h3>

        <p style={{ fontSize: '13px', color: '#7c7c9a', lineHeight: 1.6, marginBottom: '20px' }}>
          {this.props.section
            ? `The ${this.props.section} section encountered an unexpected error.`
            : 'An unexpected error occurred.'}
          {' '}Your data is safe.
        </p>

        {/* Dev mode: show error message */}
        {isDev && this.state.error && (
          <div style={{
            background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px',
            padding: '12px', marginBottom: '16px', textAlign: 'left',
            fontFamily: 'monospace', fontSize: '11px', color: '#f06565',
            overflowX: 'auto',
          }}>
            {this.state.error.message}
          </div>
        )}

        {/* Event ID for support */}
        {this.state.eventId && !isDev && (
          <div style={{ fontSize: '11px', color: '#4a4a65', marginBottom: '16px' }}>
            Error ID: <code style={{ fontFamily: 'monospace' }}>{this.state.eventId}</code>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={this.handleReset}
            style={{
              background: '#6c63ff', color: '#fff', border: 'none',
              borderRadius: '8px', padding: '9px 20px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            ↺ Try Again
          </button>

          {this.state.eventId && (
            <button
              onClick={this.handleReport}
              style={{
                background: 'transparent', color: '#7c7c9a',
                border: '1px solid #2a2a3a', borderRadius: '8px',
                padding: '9px 16px', fontSize: '13px', cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Report Issue
            </button>
          )}

          <button
            onClick={() => window.location.href = '/dashboard'}
            style={{
              background: 'transparent', color: '#7c7c9a',
              border: '1px solid #2a2a3a', borderRadius: '8px',
              padding: '9px 16px', fontSize: '13px', cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }
}

// ── HOC wrapper ───────────────────────────────────────────────────────────
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  section: string,
) {
  function BoundedComponent(props: P) {
    return (
      <ErrorBoundary section={section}>
        <Component {...props} />
      </ErrorBoundary>
    )
  }
  BoundedComponent.displayName = `withErrorBoundary(${Component.displayName ?? Component.name})`
  return BoundedComponent
}
