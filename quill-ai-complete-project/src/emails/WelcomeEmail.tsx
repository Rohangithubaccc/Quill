import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
  Link,
  Preview,
  Font,
} from '@react-email/components'

// ─────────────────────────────────────────────────────────────────────────────
// WelcomeEmail
// Sent immediately after a user signs up and their workspace is created.
// Rendered server-side with @react-email/render (not renderToStaticMarkup).
// ─────────────────────────────────────────────────────────────────────────────

interface WelcomeEmailProps {
  firstName: string
  workspaceName: string
  trialDays: number
}

const BASE_URL = process.env.NEXT_PUBLIC_URL ?? 'https://quill.ai'

// ── Shared inline styles (email-safe — no <style> tags) ──────────────────────
const container: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
  fontFamily: 'Inter, Helvetica, Arial, sans-serif',
  backgroundColor: '#0f0f13',
  color: '#e8e8f0',
}
const card: React.CSSProperties = {
  backgroundColor: '#1e1e28',
  borderRadius: '12px',
  padding: '32px',
  margin: '24px 0',
  border: '1px solid #2a2a3a',
}
const h1Style: React.CSSProperties = {
  fontFamily: 'Helvetica, Arial, sans-serif',
  fontWeight: 800,
  fontSize: '28px',
  color: '#e8e8f0',
  margin: '0 0 8px 0',
  lineHeight: 1.2,
}
const pStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#b0b0c8',
  lineHeight: 1.7,
  margin: '0 0 16px 0',
}
const muteStyle: React.CSSProperties = { fontSize: '12px', color: '#4a4a65' }
const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid #2a2a3a',
  margin: '24px 0',
}

function EmailHeader() {
  return (
    <table width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: '8px' }}>
      <tbody><tr>
        <td style={{ padding: '24px 24px 0' }}>
          <table cellPadding="0" cellSpacing="0">
            <tbody><tr>
              <td style={{
                backgroundColor: '#6c63ff',
                borderRadius: '8px',
                padding: '8px 16px',
                fontWeight: 800,
                fontSize: '18px',
                color: '#ffffff',
                fontFamily: 'Helvetica, Arial, sans-serif',
              }}>
                ✦ Quill.AI
              </td>
            </tr></tbody>
          </table>
        </td>
      </tr></tbody>
    </table>
  )
}

function EmailFooter() {
  return (
    <table width="100%" cellPadding="0" cellSpacing="0">
      <tbody><tr>
        <td style={{ padding: '16px 24px 32px', ...muteStyle, textAlign: 'center' as const }}>
          <p style={{ margin: '0 0 4px 0' }}>
            Need help? Reply to this email or visit{' '}
            <a href="mailto:support@quill.ai" style={{ color: '#6c63ff' }}>support@quill.ai</a>
          </p>
          <p style={{ margin: 0 }}>
            © {new Date().getFullYear()} Quill.AI · All rights reserved
          </p>
        </td>
      </tr></tbody>
    </table>
  )
}

export default function WelcomeEmail({ firstName, workspaceName, trialDays }: WelcomeEmailProps) {
  return (
    <Html lang="en">
      <Head>
        <title>Welcome to Quill.AI</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <Preview>Welcome, {firstName}! Your Quill.AI workspace is ready.</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: '#0f0f13' }}>
        <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: '#0f0f13', padding: '0 16px' }}>
          <tbody><tr><td align="center">
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ ...container }}>

              <tbody>
              {/* Header */}
              <tr><td><EmailHeader /></td></tr>

              {/* Hero card */}
              <tr><td style={{ padding: '0 24px' }}>
                <table width="100%" cellPadding="0" cellSpacing="0" style={card}>
                  <tbody>
                  <tr><td>
                    <h1 style={h1Style}>Welcome, {firstName}! 🎉</h1>
                    <p style={{ ...pStyle, marginBottom: '4px' }}>
                      Your workspace <strong style={{ color: '#e8e8f0' }}>{workspaceName}</strong> is ready.
                    </p>
                    <p style={{ ...pStyle, color: '#7c7c9a', fontSize: '14px' }}>
                      You&apos;re all set to start creating AI-powered content that sounds like you.
                    </p>
                  </td></tr>
                  </tbody>
                </table>
              </td></tr>

              {/* What you can do */}
              <tr><td style={{ padding: '0 24px' }}>
                <p style={{ ...pStyle, fontWeight: 600, color: '#e8e8f0', fontSize: '14px', margin: '0 0 12px 0' }}>
                  Here&apos;s what you can do with Quill.AI:
                </p>
                {[
                  { icon: '✦', text: 'Generate blog posts, LinkedIn articles, and Twitter threads in 60 seconds' },
                  { icon: '📅', text: 'Schedule content across platforms automatically with AI-optimal timing' },
                  { icon: '📊', text: 'Track performance, engagement, and ROI in real-time' },
                ].map(({ icon, text }) => (
                  <table key={text} width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: '10px' }}>
                    <tbody><tr>
                      <td style={{ width: '32px', verticalAlign: 'top' as const, fontSize: '18px', paddingTop: '1px' }}>{icon}</td>
                      <td style={{ fontSize: '14px', color: '#b0b0c8', lineHeight: 1.6 }}>{text}</td>
                    </tr></tbody>
                  </table>
                ))}
              </td></tr>

              {/* CTA */}
              <tr><td style={{ padding: '24px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0">
                  <tbody><tr><td align="center">
                    <a
                      href={`${BASE_URL}/dashboard`}
                      style={{
                        display: 'inline-block',
                        backgroundColor: '#6c63ff',
                        color: '#ffffff',
                        textDecoration: 'none',
                        borderRadius: '8px',
                        padding: '13px 28px',
                        fontWeight: 700,
                        fontSize: '15px',
                        fontFamily: 'Helvetica, Arial, sans-serif',
                      }}
                    >
                      Open Your Workspace →
                    </a>
                  </td></tr></tbody>
                </table>
              </td></tr>

              {/* Trial reminder */}
              <tr><td style={{ padding: '20px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0">
                  <tbody><tr><td style={{
                    backgroundColor: 'rgba(245,200,66,0.08)',
                    border: '1px solid rgba(245,200,66,0.25)',
                    borderRadius: '8px',
                    padding: '14px 18px',
                  }}>
                    <p style={{ margin: 0, fontSize: '13px', color: '#f5c842', lineHeight: 1.6 }}>
                      🎁 You have <strong>{trialDays} days free</strong> — no credit card needed.
                      Upgrade anytime in Settings.
                    </p>
                  </td></tr></tbody>
                </table>
              </td></tr>

              {/* Divider */}
              <tr><td style={{ padding: '0 24px' }}>
                <div style={dividerStyle} />
              </td></tr>

              {/* Footer */}
              <tr><td><EmailFooter /></td></tr>
              </tbody>

            </table>
          </td></tr></tbody>
        </table>
      </Body>
    </Html>
  )
}
