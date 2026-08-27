'use client'

import Link from 'next/link'

interface EmptyStateProps {
  icon: string
  title: string
  body: string
  cta?: { label: string; href: string; onClick?: () => void }
  secondaryCta?: { label: string; href: string }
}

export default function EmptyState({ icon, title, body, cta, secondaryCta }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 40px',
      maxWidth: '400px', margin: '0 auto', textAlign: 'center',
    }}>
      {/* Icon with radial glow */}
      <div style={{
        width: '96px', height: '96px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(108,99,255,0.12), transparent)',
        border: '1px solid rgba(108,99,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '40px', lineHeight: 1 }}>{icon}</span>
      </div>

      {/* Title */}
      <div style={{
        fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '20px',
        color: '#e8e8f0', marginTop: '20px', marginBottom: '10px',
      }}>
        {title}
      </div>

      {/* Body */}
      <p style={{
        fontSize: '14px', color: '#7c7c9a', lineHeight: 1.6,
        marginBottom: cta ? '24px' : '0',
      }}>
        {body}
      </p>

      {/* Primary CTA */}
      {cta && (
        cta.onClick ? (
          <button
            onClick={cta.onClick}
            style={{
              width: '100%', background: '#6c63ff', color: '#fff',
              border: 'none', borderRadius: '8px', padding: '11px 20px',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', marginBottom: secondaryCta ? '10px' : '0',
            }}
          >
            {cta.label}
          </button>
        ) : (
          <Link
            href={cta.href}
            style={{
              display: 'block', width: '100%', background: '#6c63ff',
              color: '#fff', textDecoration: 'none', borderRadius: '8px',
              padding: '11px 20px', fontSize: '14px', fontWeight: 600,
              marginBottom: secondaryCta ? '10px' : '0',
            }}
          >
            {cta.label}
          </Link>
        )
      )}

      {/* Secondary CTA */}
      {secondaryCta && (
        <Link
          href={secondaryCta.href}
          style={{
            fontSize: '13px', color: '#7c7c9a', textDecoration: 'none',
            padding: '4px 0',
          }}
        >
          {secondaryCta.label}
        </Link>
      )}
    </div>
  )
}
